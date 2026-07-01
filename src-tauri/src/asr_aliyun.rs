use base64::{engine::general_purpose, Engine as _};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};
use tokio::net::TcpStream;
use tokio::sync::{mpsc, Mutex};
use tokio::time::timeout;
use tokio_tungstenite::{
    connect_async,
    tungstenite::{client::IntoClientRequest, Message as WsMessage},
    MaybeTlsStream, WebSocketStream,
};
use uuid::Uuid;

const MODEL: &str = "qwen3-asr-flash-realtime";
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
// VAD 静音判停阈值，600ms 与火山侧体验接近
const VAD_SILENCE_MS: u64 = 600;

type AliSocket = WebSocketStream<MaybeTlsStream<TcpStream>>;

#[derive(Default)]
pub struct AsrAliyunStreams {
    sessions: Mutex<HashMap<String, AliSession>>,
}

struct AliSession {
    audio_tx: mpsc::Sender<AliCommand>,
}

enum AliCommand {
    Audio(Vec<u8>),
    Finish(Vec<u8>), // 携带尾音
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AliStartRequest {
    workspace_id: String,
    api_key: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AliAudioRequest {
    session_id: String,
    audio_base64: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AsrTranscriptEvent {
    session_id: String,
    text: String,
}

// ----------------------------------------------------------------
//  Tauri 命令
// ----------------------------------------------------------------

#[tauri::command]
pub async fn asr_ali_start_stream(
    app: AppHandle,
    state: State<'_, AsrAliyunStreams>,
    request: AliStartRequest,
) -> Result<String, String> {
    let session_id = Uuid::new_v4().to_string();
    let url = format!(
        "wss://{}/api-ws/v1/realtime?model={}",
        request.workspace_id, MODEL
    );

    let mut ws_req = url
        .into_client_request()
        .map_err(|e| format!("Ali ASR request build failed: {e}"))?;
    let h = ws_req.headers_mut();
    h.insert(
        "Authorization",
        format!("Bearer {}", request.api_key)
            .parse()
            .map_err(|e| format!("Ali ASR auth header: {e}"))?,
    );
    h.insert(
        "OpenAI-Beta",
        "realtime=v1"
            .parse()
            .map_err(|e| format!("Ali ASR beta header: {e}"))?,
    );

    let (socket, _) = timeout(CONNECT_TIMEOUT, connect_async(ws_req))
        .await
        .map_err(|_| "Ali ASR connect timed out".to_string())?
        .map_err(|e| format!("Ali ASR connect failed: {e}"))?;

    let (audio_tx, audio_rx) = mpsc::channel::<AliCommand>(64);
    let task_sid = session_id.clone();

    tokio::spawn(async move {
        run_session(socket, audio_rx, task_sid, app).await;
    });

    state
        .sessions
        .lock()
        .await
        .insert(session_id.clone(), AliSession { audio_tx });

    println!("[ALI-ASR] started: session_id={}", session_id);
    Ok(session_id)
}

#[tauri::command]
pub async fn asr_ali_push_audio(
    state: State<'_, AsrAliyunStreams>,
    request: AliAudioRequest,
) -> Result<(), String> {
    let audio = general_purpose::STANDARD
        .decode(&request.audio_base64)
        .map_err(|e| format!("Invalid audio: {e}"))?;

    let tx = {
        let sessions = state.sessions.lock().await;
        sessions
            .get(&request.session_id)
            .map(|s| s.audio_tx.clone())
    }
    .ok_or_else(|| "Ali ASR session not found".to_string())?;

    tx.send(AliCommand::Audio(audio))
        .await
        .map_err(|_| "Ali ASR sender closed".to_string())
}

#[tauri::command]
pub async fn asr_ali_finish_stream(
    state: State<'_, AsrAliyunStreams>,
    request: AliAudioRequest,
) -> Result<(), String> {
    let tail = general_purpose::STANDARD
        .decode(&request.audio_base64)
        .map_err(|e| format!("Invalid tail audio: {e}"))?;

    let session = state
        .sessions
        .lock()
        .await
        .remove(&request.session_id)
        .ok_or_else(|| "Ali ASR session not found".to_string())?;

    session
        .audio_tx
        .send(AliCommand::Finish(tail))
        .await
        .map_err(|_| "Ali ASR sender closed".to_string())
}

// ----------------------------------------------------------------
//  会话主循环
// ----------------------------------------------------------------

async fn run_session(
    socket: AliSocket,
    mut audio_rx: mpsc::Receiver<AliCommand>,
    session_id: String,
    app: AppHandle,
) {
    let (mut writer, mut reader) = socket.split();

    // 初始化：VAD 模式，静音 600ms 判停
    let init = json!({
        "event_id": Uuid::new_v4().to_string(),
        "type": "session.update",
        "session": {
            "modalities": ["text"],
            "input_audio_format": "pcm",
            "sample_rate": 16000,
            "turn_detection": {
                "type": "server_vad",
                "threshold": 0.4,
                "silence_duration_ms": VAD_SILENCE_MS
            }
        }
    });
    if writer
        .send(WsMessage::Text(init.to_string()))
        .await
        .is_err()
    {
        println!("[ALI-ASR] session init send failed");
        return;
    }

    // 写入任务：把音频帧和 finish 事件推到 WebSocket
    let write_task = tokio::spawn(async move {
        while let Some(cmd) = audio_rx.recv().await {
            match cmd {
                AliCommand::Audio(audio) => {
                    let event = json!({
                        "event_id": Uuid::new_v4().to_string(),
                        "type": "input_audio_buffer.append",
                        "audio": general_purpose::STANDARD.encode(&audio)
                    });
                    if writer.send(WsMessage::Text(event.to_string())).await.is_err() {
                        break;
                    }
                }
                AliCommand::Finish(tail) => {
                    // 先把尾音推进去再收尾
                    if !tail.is_empty() {
                        let event = json!({
                            "event_id": Uuid::new_v4().to_string(),
                            "type": "input_audio_buffer.append",
                            "audio": general_purpose::STANDARD.encode(&tail)
                        });
                        let _ = writer.send(WsMessage::Text(event.to_string())).await;
                    }
                    let finish = json!({
                        "event_id": Uuid::new_v4().to_string(),
                        "type": "session.finish"
                    });
                    let _ = writer.send(WsMessage::Text(finish.to_string())).await;
                    break;
                }
            }
        }
    });

    // 读取任务：只关心转写完成和会话结束
    loop {
        let msg = match reader.next().await {
            Some(Ok(m)) => m,
            _ => break,
        };

        let text = match msg {
            WsMessage::Text(t) => t,
            WsMessage::Close(_) => break,
            _ => continue,
        };

        let Ok(data) = serde_json::from_str::<Value>(&text) else {
            continue;
        };

        let event_type = data.get("type").and_then(Value::as_str).unwrap_or("");
        println!("[ALI-ASR] event={}", event_type);

        match event_type {
            "input_audio_buffer.speech_started" => {
                // 用户开口 — 立即触发前端 barge-in 打断 TTS
                let _ = app.emit(
                    "asr://transcript",
                    AsrTranscriptEvent {
                        session_id: session_id.clone(),
                        text: String::new(),
                    },
                );
            }
            "conversation.item.input_audio_transcription.text" => {
                // 实时中间结果 — 用于触发前端 barge-in 打断 TTS
                if let Some(delta) = data.get("delta").and_then(Value::as_str) {
                    let t = delta.trim().to_string();
                    if !t.is_empty() {
                        let _ = app.emit(
                            "asr://transcript",
                            AsrTranscriptEvent {
                                session_id: session_id.clone(),
                                text: t,
                            },
                        );
                    }
                }
            }
            "conversation.item.input_audio_transcription.completed" => {
                if let Some(transcript) = data.get("transcript").and_then(Value::as_str) {
                    let t = transcript.trim().to_string();
                    if !t.is_empty() {
                        println!("[ALI-ASR] vad-end: {:?}", t);
                        let _ = app.emit(
                            "asr://vad-end",
                            AsrTranscriptEvent {
                                session_id: session_id.clone(),
                                text: t,
                            },
                        );
                    }
                }
            }
            "session.finished" => break,
            _ => {}
        }
    }

    write_task.abort();
    println!("[ALI-ASR] session ended: {}", session_id);
}
