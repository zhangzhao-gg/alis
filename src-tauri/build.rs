fn main() {
    tauri_build::build();

    // 显式声明：.m 文件变化时重新运行 build script（cc crate 的自动跟踪有时不生效）
    println!("cargo:rerun-if-changed=src/audio_engine.m");

    // 编译 ObjC 音频引擎；framework 链接由 audio_engine.rs 的 #[link] 负责
    cc::Build::new()
        .file("src/audio_engine.m")
        .compile("audio_engine");
}
