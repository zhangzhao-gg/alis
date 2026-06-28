# 语音模式技术架构

本文档描述 alis 在 macOS 上实现"类微信电话"全双工语音对话的技术方案。

## 核心目标

- **全双工**：边录音（ASR）边播放（TTS），互不阻塞
- **通话模式**：走蓝牙 HFP 通话通道，使用通话音量（非媒体音量）
- **回声消除**：TTS 声音不被麦克风录回去（AEC）
- **自动增益**：麦克风音量自动调节（AGC）
- **降噪**：消除环境噪声（NS）

## 整体架构

```
前端 (WKWebView)                    主进程 (Tauri/Rust)
─────────────────                   ─────────────────────────
                                    VoiceProcessingIO AudioUnit
                                    (macOS 底层 VoIP API)
                                        ├─ Bus 1 (input)
                                        │   ↓ InputCallback
                                        │   ↓ Float32 → Int16 转换
                                        │   ↓ 写入 Rust ring buffer
录音轮询 ◄── invoke audio_poll_pcm ◄── 16kHz/16bit/mono PCM
                                        │
                                        └─ Bus 0 (output)
                                            ↑ RenderCallback
                                            ↑ 从 ring buffer 拉数据
TTS invoke tts_play ──────────────► 合成 MP3 → AVAudioConverter 转 16kHz/Float32/mono
                                    → 写入播放 ring buffer → AudioUnit 拉取播放
```

## 关键技术选型

### 用 `kAudioUnitSubType_VoiceProcessingIO` 而非 AVAudioEngine

**这是整个方案能成功的关键**。

| 方案 | 结果 | 原因 |
|------|------|------|
| AVAudioEngine + `setVoiceProcessingEnabled` | ❌ 失败 -10849 | 要创建 aggregate device，要求输入输出声道匹配。蓝牙 HFP 模式下输入 1ch + 输出 2ch，不匹配 |
| `kAudioUnitSubType_VoiceProcessingIO` AudioUnit | ✅ 成功 | 不走 aggregate device，系统隐式设置 voiceChat mode |

**VoiceProcessingIO 的优势**：
1. 系统隐式设置 `voiceChat` mode → 走通话通道（HFP 通话音量）
2. 不需要 `AVAudioSession`（macOS 上 `API_UNAVAILABLE(macos)`）
3. 不需要创建 aggregate device → 绕过声道匹配问题
4. 内置 AEC/AGC/NS（回声消除 + 自动增益 + 降噪）
5. 这是 macOS 上做 VoIP 的正确方式（微信、Twilio 用的同一套 API）

参考：
- [AVAudioEngine in a VoIP app - Apple Developer Forums](https://developer.apple.com/forums/thread/97679)
- [Twilio Video Quickstart - ExampleAVAudioEngineDevice.m](https://github.com/twilio/video-quickstart-swift/blob/master/AudioDeviceExample/AudioDevices/ExampleAVAudioEngineDevice.m)

## 音频数据流

### 录音流（ASR 输入）

1. VoiceProcessingIO Bus 1（input）触发 `InputCallback`
2. 回调里调 `AudioUnitRender` 拿到麦克风 PCM（Float32）
3. Float32 → Int16 转换（限幅 ±1.0，乘 32767）
4. 通过 `AudioCaptureCallback` 函数指针推给 Rust
5. Rust 写入全局 `PCM_BUFFER`（Mutex\<Vec\<i16\>\>）
6. 前端通过 `invoke('audio_poll_pcm')` 轮询拉取（base64 编码返回）
7. 前端把 PCM 推给 ASR WebSocket

**录音格式**：16kHz / 16bit / mono / Float32（VoiceProcessingIO 要求 Float32）

### 播放流（TTS 输出）

1. 前端 `invoke('tts_play')` → Rust 调火山引擎 TTS HTTP API
2. 响应是 NDJSON，`DATA` 字段是 base64 编码的 MP3 chunk
3. 拼接所有 chunk 得到完整 MP3，写临时文件
4. ObjC `audio_engine_play_file` 用 `AVAudioFile` 解码 MP3
5. 用 `AVAudioConverter` 把文件格式（24kHz/1ch）转成 16kHz/Float32/mono
6. 写入播放 ring buffer（1MB，约 13 秒容量）
7. VoiceProcessingIO Bus 0（output）触发 `RenderCallback`
8. 回调从 ring buffer 拉数据填充输出 buffer
9. 播放完成后清空 ring buffer

**播放格式**：16kHz / Float32 / mono（与录音格式一致）

## 核心文件

### [src-tauri/src/audio_engine.m](../src-tauri/src/audio_engine.m)
- **角色**：ObjC 实现 VoiceProcessingIO AudioUnit
- **关键函数**：
  - `audio_engine_init`：初始化录音/播放格式（16kHz/Float32/mono）+ ring buffer
  - `audio_engine_start`：创建 VoiceProcessingIO AudioUnit，设置 Bus 0/1，启动
  - `audio_engine_start_recording`：注册录音回调
  - `audio_engine_play_file`：解码 MP3 + 转换格式 + 写入 ring buffer
  - `InputCallback`：录音回调（Float32 → Int16 → 推给 Rust）
  - `RenderCallback`：播放回调（从 ring buffer 拉数据）

### [src-tauri/src/audio_engine.rs](../src-tauri/src/audio_engine.rs)
- **角色**：Rust 安全封装 + Tauri 命令
- **关键函数**：
  - `capture_callback`：接收 ObjC 推来的 PCM，写入全局 buffer
  - `poll_pcm`：拉取并清空 buffer，返回字节序列
  - Tauri 命令：`audio_start_capture` / `audio_stop_capture` / `audio_poll_pcm`

### [src-tauri/src/tts.rs](../src-tauri/src/tts.rs)
- **角色**：TTS 合成 + 播放
- **关键函数**：
  - `tts_play`：合成 MP3 → 写临时文件 → 调 `audio_engine::play_file` → 轮询 `is_playing` → 删临时文件
  - `tts_stop`：调 `audio_engine::stop`

### [src-tauri/build.rs](../src-tauri/build.rs)
- **角色**：编译 ObjC 代码 + 链接框架
- **关键**：
  - `cc::Build::new().file("src/audio_engine.m").compile("audio_engine")`
  - `cargo:rerun-if-changed=src/audio_engine.m`（确保修改后重新编译）

### [src/lib/tts.ts](../src/lib/tts.ts)
- **角色**：前端 TTS 调用封装
- **逻辑**：`invoke("tts_play")` 阻塞直到播放完成，`invoke("tts_stop")` 取消

### [src/lib/recorder.ts](../src/lib/recorder.ts)
- **角色**：前端录音轮询（不再用 getUserMedia）
- **逻辑**：定时 `invoke('audio_poll_pcm')` 拉取 PCM → 推给 ASR

### [src/components/InputBar/index.tsx](../src/components/InputBar/index.tsx)
- **角色**：语音模式 UI 控制
- **逻辑**：
  - 开语音模式 → `invoke('audio_start_capture')`
  - ASR 结果回来 → 打断 TTS（barge-in）→ 处理用户输入
  - 关语音模式 → `invoke('audio_stop_capture')`

## 蓝牙耳机模式说明

蓝牙耳机有两种模式：

| 模式 | 用途 | 音质 | 方向 |
|------|------|------|------|
| A2DP | 媒体播放 | 44.1kHz 立体声 | 单向（只能听） |
| HFP | 通话 | 16kHz 单声道 | 双向（能听能说） |

**开录音 → 蓝牙耳机切到 HFP → 输出也变成 16kHz 单声道**。这是蓝牙协议的物理限制，无法绕过——只要用蓝牙耳机录音，就必然切 HFP，必然 16kHz 音质。

微信通话也是 16kHz，只是平时没注意。VoiceProcessingIO 走 HFP 通话通道，音质与微信一致。

## 踩过的坑（避免重复）

1. **AVAudioSession 在 macOS 不可用**
   - `setCategory` / `setActive` / `setMode` 全部 `API_UNAVAILABLE(macos)`
   - 解决：放弃 AVAudioSession，用 VoiceProcessingIO 隐式设置 voiceChat mode

2. **AVAudioEngine 的 `setVoiceProcessingEnabled` 失败 -10849**
   - 原因：VP 要创建 aggregate device，要求输入输出声道匹配
   - 蓝牙 HFP 模式：输入 1ch + 输出 2ch → 不匹配 → 失败
   - 这是 macOS AVAudioEngine VP 的已知限制，Apple 论坛 5 天前的帖子还没回复
   - 解决：改用 `kAudioUnitSubType_VoiceProcessingIO` AudioUnit

3. **VP 必须在 engine 停止状态开启**
   - WWDC 2019 Session 510 明确规定
   - 错误顺序：start → setVoiceProcessingEnabled → 静默失败
   - 正确顺序：prepare → setVoiceProcessingEnabled → start

4. **Rust 不能捕获 ObjC 异常**
   - `fatal runtime error: Rust cannot catch foreign exceptions, aborting`
   - 解决：所有 ObjC 函数用 `@try/@catch` 包裹

5. **AVAudioConverter 转换失败 paramErr -50**
   - 原因：用 `convertToBuffer:error:withInputFromBlock:`（block 方式）才能正确处理复合转换
   - 旧 API `convertTo:error:withInputFromBlock:` 不可用

6. **cargo 不重新编译 .m 文件**
   - 解决：`build.rs` 里加 `cargo:rerun-if-changed=src/audio_engine.m`

7. **ObjC `__block` 变量**
   - block 内修改外部变量需要 `__block` 修饰符
   - 否则编译错误：`variable is not assignable (missing __block type specifier)`

## 性能数据

- **录音延迟**：VoiceProcessingIO 回调直接拿 PCM，无额外缓冲
- **播放延迟**：TTS 合成完 → 写 ring buffer → AudioUnit 拉取（约 20-50ms）
- **首字延迟**：TTS 合成需 5-13 秒（取决于文本长度），这是 HTTP API 的限制
- **内存占用**：播放 ring buffer 1MB（约 13 秒 16kHz mono Float32）

## 未来优化方向

1. **TTS 流式播放**：不等全部合成完，合成到第一个 chunk 就开始播（降低首字延迟）
2. **barge-in 优化**：TTS 播放时 ASR 识别到用户说话 → 立即停止 TTS
3. **音频质量监控**：日志记录 AEC/AGC/NS 是否生效
4. **多设备支持**：枚举音频设备，让用户选择输入输出
