# 语音模式技术架构

本文档描述 alis 在 macOS 上实现"类微信电话"全双工语音对话的技术方案，以及普通文字消息下的清晰语音播放路径。

## 核心目标

- **全双工**：边录音（ASR）边播放（TTS），互不阻塞
- **通话模式**：走蓝牙 HFP 通话通道，使用通话音量（非媒体音量）
- **回声消除**：TTS 声音不被麦克风录回去（AEC）
- **自动增益**：麦克风音量自动调节（AGC）
- **降噪**：消除环境噪声（NS）
- **清晰播放**：单独发送文字消息时，TTS 走普通媒体播放层，不进入通话模式

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
语音模式 TTS
invoke tts_prepare/tts_start ────► 合成 MP3 → AVAudioConverter 转 16kHz/Float32/mono
                                    → 写入播放 ring buffer → AudioUnit 拉取播放

普通文字消息 TTS
Audio(Blob URL) ◄───────────────── invoke tts_synthesize
媒体播放层播放 MP3                  合成 MP3 → base64 返回前端
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

TTS 有两条播放路径，按交互场景分流。

| 场景 | 播放层 | 目标 | macOS 音频模式 |
|------|--------|------|----------------|
| 单独发送文字消息，开启 TTS 回复 | 前端 `HTMLAudioElement` 播放 MP3 | 保留清晰媒体音质 | 普通媒体播放，不进入通话模式 |
| 语音对话模式，麦克风常开 | `VoiceProcessingIO` AudioUnit | 全双工、barge-in、AEC/AGC/NS | 通话模式，蓝牙耳机可能切 HFP |

#### 普通文字消息：清晰语音层

1. 前端 `playTts({ mode: "normal" })` → `invoke('tts_synthesize')`
2. Rust 调火山引擎 TTS HTTP API
3. 响应是 NDJSON，`DATA` 字段是 base64 编码的 MP3 chunk
4. Rust 拼接所有 chunk 得到完整 MP3，并以 base64 返回前端
5. 前端把 base64 转成 `Blob`，创建 `Object URL`
6. 前端用 `HTMLAudioElement` 播放 MP3
7. 播放结束或取消时释放 `Object URL`

这条路径不会调用 `audio_engine::init` / `audio_engine::start`，也不会创建 `kAudioUnitSubType_VoiceProcessingIO`。因此普通文字消息触发的语音回复走的是清晰的媒体播放层，不会把 macOS 或蓝牙耳机切到语音通话模式。

**播放格式**：由系统媒体播放栈解码 MP3，保留普通媒体播放音质。

#### 语音对话模式：双工通话层

1. 前端 `playTts({ mode: "duplex" })` → `invoke('tts_prepare')`
2. Rust 调火山引擎 TTS HTTP API
3. 响应是 NDJSON，`DATA` 字段是 base64 编码的 MP3 chunk
4. 拼接所有 chunk 得到完整 MP3，写临时文件
5. ObjC `audio_engine_play_file` 用 `AVAudioFile` 解码 MP3
6. 用 `AVAudioConverter` 把文件格式（24kHz/1ch）转成 16kHz/Float32/mono
7. 写入播放 ring buffer（1MB，约 13 秒容量）
8. 前端触发文字显示后调用 `invoke('tts_start')`
9. VoiceProcessingIO Bus 0（output）触发 `RenderCallback`
10. 回调从 ring buffer 拉数据填充输出 buffer
11. 播放完成后清空 ring buffer

**播放格式**：16kHz / Float32 / mono（与录音格式一致）。这是为了全双工和回声消除，不追求媒体播放音质。

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
- **角色**：TTS 合成 + 两种播放路径的后端入口
- **关键函数**：
  - `tts_synthesize`：普通文字消息路径，只合成 MP3 并返回 base64，前端负责清晰播放
  - `tts_prepare`：语音对话路径，合成 MP3 → 写临时文件 → 调 `audio_engine::play_file` 填充 ring buffer
  - `tts_start`：语音对话路径，启动 VoiceProcessingIO 播放并阻塞到播放完成
  - `tts_stop`：调 `audio_engine::stop`

### [src-tauri/build.rs](../src-tauri/build.rs)
- **角色**：编译 ObjC 代码 + 链接框架
- **关键**：
  - `cc::Build::new().file("src/audio_engine.m").compile("audio_engine")`
  - `cargo:rerun-if-changed=src/audio_engine.m`（确保修改后重新编译）

### [src/lib/tts.ts](../src/lib/tts.ts)
- **角色**：前端 TTS 调用封装
- **逻辑**：
  - `mode: "normal"`：`invoke("tts_synthesize")` 拿 MP3 base64，转 `Blob` 后用 `HTMLAudioElement` 播放
  - `mode: "duplex"`：`invoke("tts_prepare")` 填 ring buffer，再 `invoke("tts_start")` 走 VoiceProcessingIO 播放
  - `cancel()`：普通路径停止前端 `Audio`，双工路径调用 `invoke("tts_stop")`

### [src/lib/recorder.ts](../src/lib/recorder.ts)
- **角色**：前端录音轮询（不再用 getUserMedia）
- **逻辑**：定时 `invoke('audio_poll_pcm')` 拉取 PCM → 推给 ASR

### [src/components/InputBar/index.tsx](../src/components/InputBar/index.tsx)
- **角色**：语音模式 UI 控制
- **逻辑**：
  - 开语音模式 → `invoke('audio_start_capture')`
  - 文字发送触发 TTS → `playTts({ mode: "normal" })`，走清晰媒体播放层
  - 语音模式触发 TTS → `playTts({ mode: "duplex" })`，走 VoiceProcessingIO 双工层
  - ASR 结果回来 → 打断 TTS（barge-in）→ 处理用户输入
  - 关语音模式 → `invoke('audio_stop_capture')`

## 蓝牙耳机模式说明

蓝牙耳机有两种模式：

| 模式 | 用途 | 音质 | 方向 |
|------|------|------|------|
| A2DP | 媒体播放 | 44.1kHz 立体声 | 单向（只能听） |
| HFP | 通话 | 16kHz 单声道 | 双向（能听能说） |

**开录音 → 蓝牙耳机切到 HFP → 输出也变成 16kHz 单声道**。这是蓝牙协议的物理限制，无法绕过——只要用蓝牙耳机录音，就必然切 HFP，必然 16kHz 音质。

普通文字消息的 TTS 回复不打开录音，也不启动 VoiceProcessingIO，因此不会触发这条 HFP 通话链路。它走系统媒体播放层，音质按普通媒体播放处理。

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
- **普通播放延迟**：TTS 合成完 → 前端 `Audio` 播放 MP3（不进入通话模式）
- **双工播放延迟**：TTS 合成完 → 写 ring buffer → AudioUnit 拉取（约 20-50ms）
- **首字延迟**：TTS 合成需 5-13 秒（取决于文本长度），这是 HTTP API 的限制
- **内存占用**：播放 ring buffer 1MB（约 13 秒 16kHz mono Float32）

## 未来优化方向

1. **TTS 流式播放**：不等全部合成完，合成到第一个 chunk 就开始播（降低首字延迟）
2. **barge-in 优化**：TTS 播放时 ASR 识别到用户说话 → 立即停止 TTS
3. **音频质量监控**：日志记录 AEC/AGC/NS 是否生效
4. **多设备支持**：枚举音频设备，让用户选择输入输出
