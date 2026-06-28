mod asr;
mod audio_engine;
mod tts;

use asr::{asr_finish_stream, asr_push_audio, asr_start_stream, AsrStreams};
use audio_engine::{audio_poll_pcm, audio_start_capture, audio_stop_capture};
use tts::{tts_play, tts_stop};

// Tauri 应用库入口，注册插件和命令
pub fn run() {
    tauri::Builder::default()
        .manage(AsrStreams::default())
        .plugin(tauri_plugin_sql::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            tts_play,
            tts_stop,
            asr_start_stream,
            asr_push_audio,
            asr_finish_stream,
            audio_start_capture,
            audio_stop_capture,
            audio_poll_pcm
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
