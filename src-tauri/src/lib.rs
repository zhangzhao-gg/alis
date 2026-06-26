mod asr;
mod tts;

use asr::{asr_finish_stream, asr_push_audio, asr_start_stream, AsrStreams};
use tts::synthesize_tts;

// Tauri 应用库入口，注册插件和命令
pub fn run() {
    tauri::Builder::default()
        .manage(AsrStreams::default())
        .plugin(tauri_plugin_sql::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            synthesize_tts,
            asr_start_stream,
            asr_push_audio,
            asr_finish_stream
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
