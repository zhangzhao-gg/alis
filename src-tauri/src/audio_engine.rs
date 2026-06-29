/**
 * [INPUT]: extern "C" 调用 audio_engine.m 编译的 ObjC 函数
 * [OUTPUT]: 提供安全 Rust 封装 init/start/start_recording/stop_recording/play_file/is_playing/stop/stop_engine
 * [POS]: Tauri 后端音频引擎桥接层
 *        录音 PCM 通过 ObjC 回调写入全局 ring buffer，前端轮询拉取
 * [PROTOCOL]: 变更时更新此头部
 */

use std::sync::Mutex;

#[cfg(target_os = "macos")]
#[link(name = "AVFAudio", kind = "framework")]
#[link(name = "AudioToolbox", kind = "framework")]
extern "C" {
    fn audio_engine_init() -> bool;
    fn audio_engine_start() -> bool;
    fn audio_engine_start_recording(callback: unsafe extern "C" fn(*const i16, i32)) -> bool;
    fn audio_engine_stop_recording();
    fn audio_engine_play_file(path: *const i8) -> f64;
    fn audio_engine_is_playing() -> bool;
    fn audio_engine_start_playback();
    fn audio_engine_stop();
    fn audio_engine_stop_engine();
}

// ===== PCM 录音缓冲 =====
// ObjC 回调把 16kHz/16bit/mono PCM 写入这里，前端轮询拉取
static PCM_BUFFER: Mutex<Vec<i16>> = Mutex::new(Vec::new());

#[cfg(target_os = "macos")]
unsafe extern "C" fn capture_callback(samples: *const i16, count: i32) {
    if count <= 0 || samples.is_null() {
        return;
    }
    let slice = std::slice::from_raw_parts(samples, count as usize);
    if let Ok(mut buf) = PCM_BUFFER.lock() {
        buf.extend_from_slice(slice);
        // 防止 buffer 无限增长（最多保留 10 秒：16000 * 10 = 160000 samples）
        if buf.len() > 160_000 {
            let drain = buf.len() - 160_000;
            buf.drain(0..drain);
        }
    }
}

#[cfg(target_os = "macos")]
pub fn init() -> bool {
    unsafe { audio_engine_init() }
}

#[cfg(target_os = "macos")]
pub fn start() -> bool {
    unsafe { audio_engine_start() }
}

#[cfg(target_os = "macos")]
pub fn start_recording() -> Result<(), String> {
    if !unsafe { audio_engine_start_recording(capture_callback) } {
        return Err("audio_engine_start_recording failed".to_string());
    }
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn stop_recording() {
    unsafe { audio_engine_stop_recording() }
    if let Ok(mut buf) = PCM_BUFFER.lock() {
        buf.clear();
    }
}

/// 拉取当前缓冲的 PCM 样本（16bit mono），返回后清空缓冲
/// 转成字节序列（小端）供前端使用
#[cfg(target_os = "macos")]
pub fn poll_pcm() -> Vec<u8> {
    if let Ok(mut buf) = PCM_BUFFER.lock() {
        if buf.is_empty() {
            return Vec::new();
        }
        let mut bytes = Vec::with_capacity(buf.len() * 2);
        for &sample in buf.iter() {
            bytes.push((sample & 0xff) as u8);
            bytes.push((sample >> 8) as u8);
        }
        buf.clear();
        return bytes;
    }
    Vec::new()
}

#[cfg(target_os = "macos")]
pub fn play_file(path: &str) -> Result<f64, String> {
    let c_path = std::ffi::CString::new(path)
        .map_err(|e| format!("path to CString failed: {e}"))?;
    let duration = unsafe { audio_engine_play_file(c_path.as_ptr()) };
    if duration < 0.0 {
        Err("audio_engine_play_file failed".to_string())
    } else {
        Ok(duration)
    }
}

#[cfg(target_os = "macos")]
pub fn is_playing() -> bool {
    unsafe { audio_engine_is_playing() }
}

#[cfg(target_os = "macos")]
pub fn start_playback() {
    unsafe { audio_engine_start_playback() }
}

#[cfg(target_os = "macos")]
pub fn stop() {
    unsafe { audio_engine_stop() }
}

#[cfg(target_os = "macos")]
pub fn stop_engine() {
    unsafe { audio_engine_stop_engine() }
}

// ===== 非 macOS 平台 stub =====
#[cfg(not(target_os = "macos"))]
pub fn init() -> bool { false }
#[cfg(not(target_os = "macos"))]
pub fn start() -> bool { false }
#[cfg(not(target_os = "macos"))]
pub fn start_recording() -> Result<(), String> { Err("not supported".into()) }
#[cfg(not(target_os = "macos"))]
pub fn stop_recording() {}
#[cfg(not(target_os = "macos"))]
pub fn poll_pcm() -> Vec<u8> { Vec::new() }
#[cfg(not(target_os = "macos"))]
pub fn play_file(_: &str) -> Result<f64, String> { Err("not supported".into()) }
#[cfg(not(target_os = "macos"))]
pub fn is_playing() -> bool { false }
#[cfg(not(target_os = "macos"))]
pub fn stop() {}
#[cfg(not(target_os = "macos"))]
pub fn stop_engine() {}

// ===== Tauri 命令 =====
// 供前端调用：启动引擎 + 开始录音
#[tauri::command]
pub async fn audio_start_capture() -> Result<(), String> {
    if !init() {
        return Err("audio engine init failed".to_string());
    }
    if !start() {
        return Err("audio engine start failed".to_string());
    }
    start_recording()
}

// 供前端调用：停止录音
// 如果没有 TTS 在播放，停掉整个 engine 释放麦克风
#[tauri::command]
pub async fn audio_stop_capture() -> Result<(), String> {
    stop_recording();
    if !is_playing() {
        // 没有 TTS 在播，停 engine 释放麦克风
        stop_engine();
    }
    Ok(())
}

// 供前端调用：拉取 PCM 数据（16kHz/16bit/mono，小端字节序列）
// 返回 base64 编码，避免大数组在 IPC 传输时出问题
#[tauri::command]
pub async fn audio_poll_pcm() -> Result<String, String> {
    use base64::{engine::general_purpose, Engine as _};
    let bytes = poll_pcm();
    Ok(general_purpose::STANDARD.encode(bytes))
}
