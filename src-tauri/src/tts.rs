use base64::{engine::general_purpose, Engine as _};
use serde::Deserialize;
use serde_json::json;
use std::time::Duration;

use crate::audio_engine;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsRequest {
    api_key: String,
    resource_id: String,
    speaker: String,
    text: String,
}

#[derive(Debug, Deserialize)]
struct TtsResponse {
    #[serde(alias = "CODE")]
    code: i32,
    #[serde(alias = "MESSAGE")]
    message: String,
    #[serde(alias = "DATA")]
    data: Option<String>,
}

/// 合成 TTS 音频，返回 MP3 bytes
async fn synthesize_mp3(request: &TtsRequest) -> Result<Vec<u8>, String> {
    println!(
        "[TTS] synthesize request: chars={}, resource_id={}, speaker={}",
        request.text.chars().count(),
        request.resource_id,
        request.speaker
    );

    let payload = json!({
        "req_params": {
            "text": request.text,
            "speaker": request.speaker,
            "audio_params": {
                "format": "mp3",
                "sample_rate": 24000,
                "speech_rate": -10
            }
        }
    });

    let response = reqwest::Client::new()
        .post("https://openspeech.bytedance.com/api/v3/tts/unidirectional")
        .header("X-Api-Key", request.api_key.clone())
        .header("X-Api-Resource-Id", request.resource_id.clone())
        .header("Content-Type", "application/json")
        .header("Connection", "keep-alive")
        .json(&payload)
        .send()
        .await
        .map_err(|err| format!("TTS request failed: {err}"))?;

    println!("[TTS] response status: {}", response.status());
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("TTS API error {status}: {body}"));
    }

    let body = response
        .text()
        .await
        .map_err(|err| format!("TTS response read failed: {err}"))?;

    let mut audio = Vec::new();

    for line in body.lines().map(str::trim).filter(|line| !line.is_empty()) {
        let payload: TtsResponse = serde_json::from_str(line)
            .map_err(|err| format!("TTS JSON parse failed: {err}: {line}"))?;

        if !is_success_code(payload.code) {
            return Err(format!("TTS API error {}: {}", payload.code, payload.message));
        }

        if let Some(data) = payload.data.filter(|data| !data.is_empty()) {
            let mut chunk = general_purpose::STANDARD
                .decode(data)
                .map_err(|err| format!("TTS audio decode failed: {err}"))?;
            audio.append(&mut chunk);
        }
    }

    if audio.is_empty() {
        return Err("TTS API returned empty audio".to_string());
    }

    println!("[TTS] decoded audio bytes: {}", audio.len());
    Ok(audio)
}

/// 第一步：合成 MP3 + 解码 + 填充 ring buffer（不出声）
/// 前端调用后可同步触发打字机动画，再调 tts_start 出声
#[tauri::command]
pub async fn tts_prepare(request: TtsRequest) -> Result<(), String> {
    println!("[TTS] tts_prepare: chars={}", request.text.chars().count());

    // 1. 合成 MP3
    let mp3_bytes = synthesize_mp3(&request).await?;
    println!("[TTS] synthesized bytes: {}", mp3_bytes.len());

    // 2. 确保音频引擎已启动
    if !audio_engine::init() {
        return Err("audio engine init failed".to_string());
    }
    if !audio_engine::start() {
        return Err("audio engine start failed".to_string());
    }

    // 3. 写临时文件 → 解码 → 填充 ring buffer
    let temp_path = std::env::temp_dir().join(format!("alis_tts_{}.mp3", uuid::Uuid::new_v4()));
    std::fs::write(&temp_path, &mp3_bytes)
        .map_err(|e| format!("write temp file failed: {e}"))?;

    let duration = audio_engine::play_file(temp_path.to_str().unwrap())?;
    println!("[TTS] ring buffer filled, duration: {:.2}s", duration);

    // 4. PCM 已在 ring buffer，临时文件可删
    let _ = std::fs::remove_file(&temp_path);

    Ok(())
}

/// 第二步：设置 _playing=true 立即出声，阻塞到播放完成
#[tauri::command]
pub async fn tts_start() -> Result<(), String> {
    println!("[TTS] tts_start: setting _playing=true");
    audio_engine::start_playback();

    // 轮询直到播放完成
    loop {
        if !audio_engine::is_playing() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }

    println!("[TTS] playback finished");
    Ok(())
}

/// 停止 TTS 播放
#[tauri::command]
pub async fn tts_stop() -> Result<(), String> {
    audio_engine::stop();
    Ok(())
}

fn is_success_code(code: i32) -> bool {
    code == 0 || code == 20000000
}
