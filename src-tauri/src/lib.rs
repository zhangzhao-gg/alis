mod asr;
mod asr_aliyun;
mod audio_engine;
mod tts;

use asr::{asr_finish_stream, asr_push_audio, asr_start_stream, AsrStreams};
use asr_aliyun::{asr_ali_finish_stream, asr_ali_push_audio, asr_ali_start_stream, AsrAliyunStreams};
use audio_engine::{audio_poll_pcm, audio_start_capture, audio_stop_capture};
use tts::{tts_prepare, tts_start, tts_stop, tts_synthesize};

// Tauri 应用库入口，注册插件和命令
pub fn run() {
    tauri::Builder::default()
        .manage(AsrStreams::default())
        .manage(AsrAliyunStreams::default())
        .plugin(tauri_plugin_sql::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            tts_synthesize,
            tts_prepare,
            tts_start,
            tts_stop,
            asr_start_stream,
            asr_push_audio,
            asr_finish_stream,
            asr_ali_start_stream,
            asr_ali_push_audio,
            asr_ali_finish_stream,
            audio_start_capture,
            audio_stop_capture,
            audio_poll_pcm
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
