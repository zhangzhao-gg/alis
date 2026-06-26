use base64::{engine::general_purpose, Engine as _};
use flate2::{read::GzDecoder, write::GzEncoder, Compression};
use futures_util::{stream::SplitSink, stream::SplitStream, SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};
use tokio::net::TcpStream;
use tokio::sync::{mpsc, oneshot, Mutex};
use tokio::time::timeout;
use tokio_tungstenite::{
    connect_async,
    tungstenite::{client::IntoClientRequest, Error as WsError, Message as WsMessage},
    MaybeTlsStream, WebSocketStream,
};
use uuid::Uuid;

const WS_URL: &str = "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel";
const RESOURCE_ID: &str = "volc.seedasr.sauc.duration";
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const RESPONSE_TIMEOUT: Duration = Duration::from_secs(20);

const CLIENT_FULL_REQUEST: u8 = 0b0001;
const CLIENT_AUDIO_ONLY_REQUEST: u8 = 0b0010;
const SERVER_FULL_RESPONSE: u8 = 0b1001;
const SERVER_ERROR_RESPONSE: u8 = 0b1111;
const POS_SEQUENCE: u8 = 0b0001;
const NEG_WITH_SEQUENCE: u8 = 0b0011;
const JSON_SERIALIZATION: u8 = 0b0001;
const GZIP_COMPRESSION: u8 = 0b0001;

type AsrSocket = WebSocketStream<MaybeTlsStream<TcpStream>>;
type AsrWrite = SplitSink<AsrSocket, WsMessage>;
type AsrRead = SplitStream<AsrSocket>;

#[derive(Default)]
pub struct AsrStreams {
    sessions: Mutex<HashMap<String, AsrSession>>,
}

struct AsrSession {
    audio_tx: mpsc::Sender<AudioCommand>,
    result_rx: oneshot::Receiver<Result<String, String>>,
}

enum AudioCommand {
    Audio(Vec<u8>),
    Finish(Vec<u8>),
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AsrStartStreamRequest {
    api_key: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AsrAudioRequest {
    session_id: String,
    audio_base64: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AsrTranscriptEvent {
    session_id: String,
    text: String,
}

struct ParsedResponse {
    code: i32,
    message_type: u8,
    flags: u8,
    sequence: Option<i32>,
    event: Option<i32>,
    is_last: bool,
    payload_size: usize,
    payload: Option<Value>,
}

#[tauri::command]
pub async fn asr_start_stream(
    app: AppHandle,
    state: State<'_, AsrStreams>,
    request: AsrStartStreamRequest,
) -> Result<String, String> {
    let session_id = Uuid::new_v4().to_string();
    let mut socket = connect(request).await?;
    send_initial_request(&mut socket).await?;

    let (mut writer, mut reader) = socket.split();
    let (audio_tx, audio_rx) = mpsc::channel::<AudioCommand>(32);
    let (result_tx, result_rx) = oneshot::channel::<Result<String, String>>();
    let task_session_id = session_id.clone();

    tokio::spawn(async move {
        let writer_task =
            tokio::spawn(async move { send_audio_stream(&mut writer, audio_rx).await });
        let result =
            receive_stream_text(&mut reader, writer_task, task_session_id.clone(), app).await;
        let _ = result_tx.send(result);
        println!("[ASR] stream task ended: session_id={}", task_session_id);
    });

    state.sessions.lock().await.insert(
        session_id.clone(),
        AsrSession {
            audio_tx,
            result_rx,
        },
    );

    println!("[ASR] stream started: session_id={}", session_id);
    Ok(session_id)
}

#[tauri::command]
pub async fn asr_push_audio(
    state: State<'_, AsrStreams>,
    request: AsrAudioRequest,
) -> Result<(), String> {
    let audio = decode_audio(&request.audio_base64)?;
    let audio_tx = {
        let sessions = state.sessions.lock().await;
        sessions
            .get(&request.session_id)
            .map(|session| session.audio_tx.clone())
    }
    .ok_or_else(|| "ASR stream session not found".to_string())?;

    println!(
        "[ASR] queue audio chunk: session_id={}, bytes={}",
        request.session_id,
        audio.len()
    );
    audio_tx
        .send(AudioCommand::Audio(audio))
        .await
        .map_err(|_| "ASR stream sender is closed".to_string())
}

#[tauri::command]
pub async fn asr_finish_stream(
    state: State<'_, AsrStreams>,
    request: AsrAudioRequest,
) -> Result<String, String> {
    let final_audio = decode_audio(&request.audio_base64)?;
    let session = state
        .sessions
        .lock()
        .await
        .remove(&request.session_id)
        .ok_or_else(|| "ASR stream session not found".to_string())?;

    println!(
        "[ASR] finish stream: session_id={}, final_bytes={}",
        request.session_id,
        final_audio.len()
    );
    session
        .audio_tx
        .send(AudioCommand::Finish(final_audio))
        .await
        .map_err(|_| "ASR stream sender is closed".to_string())?;

    timeout(RESPONSE_TIMEOUT, session.result_rx)
        .await
        .map_err(|_| "ASR final response timed out".to_string())?
        .map_err(|_| "ASR stream result channel is closed".to_string())?
}

async fn connect(request: AsrStartStreamRequest) -> Result<AsrSocket, String> {
    let request_id = Uuid::new_v4().to_string();
    let connect_id = Uuid::new_v4().to_string();
    let api_key_hint = key_hint(&request.api_key);
    println!(
        "[ASR] websocket preparing: url={}, resource_id={}, request_id={}, connect_id={}, api_key={}",
        WS_URL, RESOURCE_ID, request_id, connect_id, api_key_hint
    );

    let mut ws_request = WS_URL
        .into_client_request()
        .map_err(|err| format!("ASR websocket request build failed: {err}"))?;
    let headers = ws_request.headers_mut();
    headers.insert(
        "X-Api-Resource-Id",
        RESOURCE_ID
            .parse()
            .map_err(|err| format!("ASR resource header build failed: {err}"))?,
    );
    headers.insert(
        "X-Api-Request-Id",
        request_id
            .parse()
            .map_err(|err| format!("ASR request id header build failed: {err}"))?,
    );
    headers.insert(
        "X-Api-Key",
        request
            .api_key
            .parse()
            .map_err(|err| format!("ASR api key header build failed: {err}"))?,
    );
    headers.insert(
        "X-Api-Connect-Id",
        connect_id
            .parse()
            .map_err(|err| format!("ASR connect id header build failed: {err}"))?,
    );
    headers.insert(
        "X-Api-Sequence",
        "-1".parse()
            .map_err(|err| format!("ASR sequence header build failed: {err}"))?,
    );

    println!("[ASR] websocket connecting: {}", WS_URL);
    let started_at = Instant::now();
    let connect_result = timeout(CONNECT_TIMEOUT, connect_async(ws_request)).await;
    let elapsed_ms = started_at.elapsed().as_millis();

    let (socket, response) = match connect_result {
        Ok(Ok((socket, response))) => (socket, response),
        Ok(Err(err)) => {
            let detail = websocket_error_detail(&err);
            println!(
                "[ASR] websocket connect failed: request_id={}, elapsed_ms={}, {}",
                request_id, elapsed_ms, detail
            );
            return Err(format!(
                "ASR websocket connect failed: request_id={}, elapsed_ms={}, {}",
                request_id, elapsed_ms, detail
            ));
        }
        Err(_) => {
            println!(
                "[ASR] websocket connect timed out: request_id={}, elapsed_ms={}, timeout_ms={}",
                request_id,
                elapsed_ms,
                CONNECT_TIMEOUT.as_millis()
            );
            return Err(format!(
                "ASR websocket connect timed out: request_id={}, elapsed_ms={}, timeout_ms={}",
                request_id,
                elapsed_ms,
                CONNECT_TIMEOUT.as_millis()
            ));
        }
    };

    println!(
        "[ASR] websocket connected: request_id={}, elapsed_ms={}, status={}",
        request_id,
        elapsed_ms,
        response.status()
    );
    Ok(socket)
}

async fn send_initial_request(socket: &mut AsrSocket) -> Result<(), String> {
    socket
        .send(WsMessage::Binary(build_full_request(1)?))
        .await
        .map_err(|err| format!("ASR full request failed: {err}"))?;

    println!("[ASR] sending initial request");
    let Some(message) = timeout(RESPONSE_TIMEOUT, socket.next())
        .await
        .map_err(|_| "ASR initial response timed out".to_string())?
    else {
        return Err("ASR initial response is empty".to_string());
    };
    let WsMessage::Binary(bytes) =
        message.map_err(|err| format!("ASR initial response failed: {err}"))?
    else {
        return Err("ASR initial response is not binary".to_string());
    };

    let response = parse_response(&bytes)?;
    println!("[ASR] initial response: {}", response.summary());
    if let Some(payload) = &response.payload {
        println!("[ASR] initial payload: {}", payload);
    }
    if response.code == 0 {
        Ok(())
    } else {
        Err(format!("ASR initial response error: {}", response.code))
    }
}

async fn send_audio_stream(
    socket: &mut AsrWrite,
    mut audio_rx: mpsc::Receiver<AudioCommand>,
) -> Result<(), String> {
    let mut seq = 2;

    while let Some(command) = audio_rx.recv().await {
        let (segment, is_last) = match command {
            AudioCommand::Audio(segment) => (segment, false),
            AudioCommand::Finish(segment) => (segment, true),
        };
        let sent_seq = if is_last { -seq } else { seq };

        socket
            .send(WsMessage::Binary(build_audio_request(
                seq, &segment, is_last,
            )?))
            .await
            .map_err(|err| format!("ASR audio send failed: {err}"))?;
        println!(
            "[ASR] sent audio chunk: seq={}, bytes={}, last={}",
            sent_seq,
            segment.len(),
            is_last
        );

        if is_last {
            break;
        }
        seq += 1;
    }

    Ok(())
}

async fn receive_stream_text(
    socket: &mut AsrRead,
    mut writer_task: tokio::task::JoinHandle<Result<(), String>>,
    session_id: String,
    app: AppHandle,
) -> Result<String, String> {
    let mut final_text = String::new();
    let mut writer_done = false;

    loop {
        let message = tokio::select! {
            writer_result = &mut writer_task, if !writer_done => {
                writer_result
                    .map_err(|err| format!("ASR audio writer task failed: {err}"))??;
                writer_done = true;
                println!("[ASR] audio writer finished");
                continue;
            }
            message = timeout(RESPONSE_TIMEOUT, socket.next()) => {
                let Some(message) = message
                    .map_err(|_| "ASR response timed out".to_string())?
                else {
                    break;
                };
                message
            }
        };

        let data = message.map_err(|err| format!("ASR response failed: {err}"))?;
        let bytes = match data {
            WsMessage::Binary(bytes) => {
                println!("[ASR] received binary message: bytes={}", bytes.len());
                bytes
            }
            WsMessage::Text(text) => {
                println!("[ASR] received text message: {}", text);
                continue;
            }
            WsMessage::Ping(bytes) => {
                println!("[ASR] received ping: bytes={}", bytes.len());
                continue;
            }
            WsMessage::Pong(bytes) => {
                println!("[ASR] received pong: bytes={}", bytes.len());
                continue;
            }
            WsMessage::Close(frame) => {
                println!("[ASR] websocket closed by server: {:?}", frame);
                break;
            }
            WsMessage::Frame(_) => {
                println!("[ASR] received raw frame");
                continue;
            }
        };

        let response = parse_response(&bytes)?;
        println!("[ASR] parsed response: {}", response.summary());

        if response.code != 0 {
            if let Some(payload) = response.payload {
                println!("[ASR] error payload: {}", payload);
            }
            return Err(format!("ASR response error: {}", response.code));
        }

        if let Some(payload) = response.payload {
            println!("[ASR] response payload: {}", payload);
            if let Some(text) = extract_text(&payload) {
                let text = text.trim().to_string();
                if !text.is_empty() && text != final_text {
                    final_text = text;
                    emit_transcript(&app, &session_id, &final_text);
                }
            }
        }

        if response.is_last {
            break;
        }
    }

    if !writer_done && !writer_task.is_finished() {
        writer_task.abort();
    }

    let text = final_text.trim().to_string();
    println!("[ASR] final text: {:?}", text);
    Ok(text)
}

fn emit_transcript(app: &AppHandle, session_id: &str, text: &str) {
    let _ = app.emit(
        "asr://transcript",
        AsrTranscriptEvent {
            session_id: session_id.to_string(),
            text: text.to_string(),
        },
    );
}

fn build_full_request(seq: i32) -> Result<Vec<u8>, String> {
    let payload = json!({
        "user": { "uid": "alis" },
        "audio": {
            "format": "pcm",
            "codec": "raw",
            "rate": 16000,
            "bits": 16,
            "channel": 1
        },
        "request": {
            "model_name": "bigmodel",
            "enable_itn": true,
            "enable_punc": true,
            "enable_ddc": true,
            "show_utterances": true,
            "enable_nonstream": false
        }
    });

    build_packet(
        CLIENT_FULL_REQUEST,
        POS_SEQUENCE,
        seq,
        payload.to_string().as_bytes(),
    )
}

fn build_audio_request(seq: i32, segment: &[u8], is_last: bool) -> Result<Vec<u8>, String> {
    let flags = if is_last {
        NEG_WITH_SEQUENCE
    } else {
        POS_SEQUENCE
    };
    let sequence = if is_last { -seq } else { seq };
    build_packet(CLIENT_AUDIO_ONLY_REQUEST, flags, sequence, segment)
}

fn build_packet(
    message_type: u8,
    flags: u8,
    sequence: i32,
    payload: &[u8],
) -> Result<Vec<u8>, String> {
    let compressed = gzip_compress(payload)?;
    let mut packet = Vec::with_capacity(12 + compressed.len());

    packet.push((0b0001 << 4) | 1);
    packet.push((message_type << 4) | flags);
    packet.push((JSON_SERIALIZATION << 4) | GZIP_COMPRESSION);
    packet.push(0);
    packet.extend_from_slice(&sequence.to_be_bytes());
    packet.extend_from_slice(&(compressed.len() as u32).to_be_bytes());
    packet.extend_from_slice(&compressed);

    Ok(packet)
}

fn parse_response(message: &[u8]) -> Result<ParsedResponse, String> {
    if message.len() < 4 {
        return Err("ASR response is too short".to_string());
    }

    let header_size = ((message[0] & 0x0f) as usize) * 4;
    let message_type = message[1] >> 4;
    let flags = message[1] & 0x0f;
    let serialization = message[2] >> 4;
    let compression = message[2] & 0x0f;

    if message.len() < header_size {
        return Err("ASR response header is invalid".to_string());
    }

    let mut offset = header_size;
    let mut code = 0;
    let is_last = flags & 0b0010 != 0;
    let mut sequence = None;
    let mut event = None;

    if flags & 0b0001 != 0 {
        sequence = Some(read_i32(message, &mut offset)?);
    }
    if flags & 0b0100 != 0 {
        event = Some(read_i32(message, &mut offset)?);
    }

    let payload_size = match message_type {
        SERVER_FULL_RESPONSE => read_u32(message, &mut offset)? as usize,
        SERVER_ERROR_RESPONSE => {
            code = read_i32(message, &mut offset)?;
            read_u32(message, &mut offset)? as usize
        }
        _ => 0,
    };

    if payload_size == 0 {
        return Ok(ParsedResponse {
            code,
            message_type,
            flags,
            sequence,
            event,
            is_last,
            payload_size,
            payload: None,
        });
    }
    if message.len() < offset + payload_size {
        return Err("ASR response payload is incomplete".to_string());
    }

    let mut payload = message[offset..offset + payload_size].to_vec();
    if compression == GZIP_COMPRESSION {
        payload = gzip_decompress(&payload)?;
    }

    let payload = if serialization == JSON_SERIALIZATION {
        Some(
            serde_json::from_slice(&payload)
                .map_err(|err| format!("ASR JSON parse failed: {err}"))?,
        )
    } else {
        None
    };

    Ok(ParsedResponse {
        code,
        message_type,
        flags,
        sequence,
        event,
        is_last,
        payload_size,
        payload,
    })
}

impl ParsedResponse {
    fn summary(&self) -> String {
        format!(
            "code={}, type=0x{:x}, flags=0x{:x}, seq={:?}, event={:?}, last={}, payload_size={}",
            self.code,
            self.message_type,
            self.flags,
            self.sequence,
            self.event,
            self.is_last,
            self.payload_size
        )
    }
}

fn read_i32(message: &[u8], offset: &mut usize) -> Result<i32, String> {
    let bytes = read_exact_4(message, offset)?;
    Ok(i32::from_be_bytes(bytes))
}

fn read_u32(message: &[u8], offset: &mut usize) -> Result<u32, String> {
    let bytes = read_exact_4(message, offset)?;
    Ok(u32::from_be_bytes(bytes))
}

fn read_exact_4(message: &[u8], offset: &mut usize) -> Result<[u8; 4], String> {
    if message.len() < *offset + 4 {
        return Err("ASR response field is incomplete".to_string());
    }

    let bytes = message[*offset..*offset + 4]
        .try_into()
        .map_err(|_| "ASR response field is invalid".to_string())?;
    *offset += 4;
    Ok(bytes)
}

fn gzip_compress(data: &[u8]) -> Result<Vec<u8>, String> {
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder
        .write_all(data)
        .map_err(|err| format!("ASR gzip compress failed: {err}"))?;
    encoder
        .finish()
        .map_err(|err| format!("ASR gzip finish failed: {err}"))
}

fn gzip_decompress(data: &[u8]) -> Result<Vec<u8>, String> {
    let mut decoder = GzDecoder::new(data);
    let mut output = Vec::new();
    decoder
        .read_to_end(&mut output)
        .map_err(|err| format!("ASR gzip decompress failed: {err}"))?;
    Ok(output)
}

fn decode_audio(audio_base64: &str) -> Result<Vec<u8>, String> {
    general_purpose::STANDARD
        .decode(audio_base64)
        .map_err(|err| format!("Invalid ASR audio chunk: {err}"))
}

fn key_hint(value: &str) -> String {
    let chars: Vec<char> = value.chars().collect();
    let len = chars.len();
    if len == 0 {
        return "len=0".to_string();
    }

    let prefix: String = chars.iter().take(4).collect();
    let suffix_start = len.saturating_sub(4);
    let suffix: String = chars.iter().skip(suffix_start).collect();
    format!("len={}, prefix={}..., suffix=...{}", len, prefix, suffix)
}

fn websocket_error_detail(err: &WsError) -> String {
    match err {
        WsError::Http(response) => {
            let body = response
                .body()
                .as_ref()
                .map(|body| String::from_utf8_lossy(body).to_string())
                .unwrap_or_default();
            let log_id = response
                .headers()
                .get("x-tt-logid")
                .and_then(|value| value.to_str().ok())
                .unwrap_or("");
            let api_message = response
                .headers()
                .get("x-api-message")
                .and_then(|value| value.to_str().ok())
                .unwrap_or("");
            format!(
                "http_status={}, x_tt_logid={}, x_api_message={}, body={}",
                response.status(),
                log_id,
                api_message,
                body
            )
        }
        _ => format!("error={err:?}"),
    }
}

fn extract_text(payload: &Value) -> Option<String> {
    if let Some(text) = payload.pointer("/result/text").and_then(Value::as_str) {
        return Some(text.to_string());
    }
    if let Some(text) = payload.get("text").and_then(Value::as_str) {
        return Some(text.to_string());
    }

    let mut fields = Vec::new();
    collect_text_fields(payload, &mut fields);

    if fields.is_empty() {
        None
    } else {
        Some(fields.join(""))
    }
}

fn collect_text_fields(value: &Value, fields: &mut Vec<String>) {
    match value {
        Value::Object(map) => {
            for (key, value) in map {
                if key == "text" {
                    if let Some(text) = value.as_str() {
                        fields.push(text.to_string());
                    }
                } else {
                    collect_text_fields(value, fields);
                }
            }
        }
        Value::Array(items) => {
            for item in items {
                collect_text_fields(item, fields);
            }
        }
        _ => {}
    }
}
