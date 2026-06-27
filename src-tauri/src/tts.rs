use base64::{engine::general_purpose, Engine as _};
use serde::Deserialize;
use serde_json::json;

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

#[tauri::command]
pub async fn synthesize_tts(request: TtsRequest) -> Result<String, String> {
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
        .header("X-Api-Key", request.api_key)
        .header("X-Api-Resource-Id", request.resource_id)
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
    Ok(general_purpose::STANDARD.encode(audio))
}

fn is_success_code(code: i32) -> bool {
    code == 0 || code == 20000000
}
