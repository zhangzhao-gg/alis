/**
 * [INPUT]: macOS AudioToolbox framework
 * [OUTPUT]: C ABI 函数供 Rust extern 调用
 * [POS]: 用 kAudioUnitSubType_VoiceProcessingIO 统一管理音频输入（录音）和输出（TTS 播放）
 *        VoiceProcessingIO 是 macOS 上做 VoIP 的正确方式：
 *        1. 系统会隐式设置 voiceChat mode → 走通话通道（HFP 通话音量）
 *        2. 不需要 AVAudioSession（macOS 不可用）
 *        3. 不需要创建 aggregate device（绕过 AVAudioEngine VP 的声道匹配问题）
 *        4. 内置 AEC/AGC/NS
 *        录音：Bus 1 (input) → 回调拿 PCM → 推给 Rust
 *        播放：Bus 0 (output) → render callback 从 TTS ring buffer 拉数据
 * [PROTOCOL]: 变更时更新此头部
 */

#import <AudioToolbox/AudioToolbox.h>
#import <Foundation/Foundation.h>
#import <AVFoundation/AVFoundation.h>

// ===== Rust 回调类型 =====
typedef void (*AudioCaptureCallback)(const int16_t *samples, int32_t sample_count);

// ===== 全局状态 =====
static AudioUnit _vioUnit = NULL;           // VoiceProcessingIO AudioUnit
static AudioCaptureCallback _capture_callback = NULL;
static volatile bool _running = false;       // AudioUnit 是否在运行
static volatile bool _playing = false;       // 是否有 TTS 在播放

// 录音格式：16kHz / 16bit / mono（ASR 需要的格式）
static AudioStreamBasicDescription _recordFormat = {0};

// 播放格式：从 TTS 文件解码后的格式（Float32 / 与文件相同）
static AudioStreamBasicDescription _playFormat = {0};

// ===== TTS 播放 ring buffer =====
// TTS 解码后的 PCM 样本存这里，render callback 从这里拉
#define PLAY_BUFFER_SIZE (1024 * 1024)  // 1MB，约 13 秒 16kHz mono Float32
static float *_play_buffer = NULL;
static volatile int _play_write_pos = 0;
static volatile int _play_read_pos = 0;
static NSLock *_play_lock = nil;

// ===== 工具函数 =====
static void CheckError(OSStatus error, const char *operation) {
    if (error == noErr) return;
    NSLog(@"[AUDIO_ENGINE] %@ failed: %d", [NSString stringWithUTF8String:operation], (int)error);
}

// ===== 录音回调 =====
// VoiceProcessingIO 的 Bus 1 (input) 回调
// 系统把麦克风录到的 PCM 推给我们
static OSStatus InputCallback(void *inRefCon,
                              AudioUnitRenderActionFlags *ioActionFlags,
                              const AudioTimeStamp *inTimeStamp,
                              UInt32 inBusNumber,
                              UInt32 inNumberFrames,
                              AudioBufferList *ioData) {
    if (!_capture_callback || !_running) return noErr;

    // 分配 buffer list 接收麦克风数据
    AudioBufferList bufferList;
    bufferList.mNumberBuffers = 1;
    bufferList.mBuffers[0].mData = NULL;
    bufferList.mBuffers[0].mDataByteSize = 0;
    bufferList.mBuffers[0].mNumberChannels = _recordFormat.mChannelsPerFrame;

    OSStatus status = AudioUnitRender(_vioUnit,
                                      ioActionFlags,
                                      inTimeStamp,
                                      inBusNumber,
                                      inNumberFrames,
                                      &bufferList);
    if (status != noErr) {
        NSLog(@"[AUDIO_ENGINE] InputCallback render failed: %d", (int)status);
        return status;
    }

    // bufferList.mBuffers[0].mData 是 Float32 数据（VoiceProcessingIO 输出 Float32）
    // 直接转成 int16 推给 Rust
    if (bufferList.mBuffers[0].mData != NULL && bufferList.mBuffers[0].mDataByteSize > 0) {
        float *floatData = (float *)bufferList.mBuffers[0].mData;
        UInt32 sampleCount = bufferList.mBuffers[0].mDataByteSize / sizeof(float);

        // 临时转成 int16
        int16_t *int16Data = (int16_t *)malloc(sampleCount * sizeof(int16_t));
        if (int16Data) {
            for (UInt32 i = 0; i < sampleCount; i++) {
                float v = floatData[i];
                if (v > 1.0f) v = 1.0f;
                if (v < -1.0f) v = -1.0f;
                int16Data[i] = (int16_t)(v * 32767.0f);
            }
            _capture_callback(int16Data, (int32_t)sampleCount);
            free(int16Data);
        }
    }

    return noErr;
}

// ===== 播放回调 =====
// VoiceProcessingIO 的 Bus 0 (output) 回调
// 系统要音频数据时，我们从 ring buffer 拉数据填充
static OSStatus RenderCallback(void *inRefCon,
                               AudioUnitRenderActionFlags *ioActionFlags,
                               const AudioTimeStamp *inTimeStamp,
                               UInt32 inBusNumber,
                               UInt32 inNumberFrames,
                               AudioBufferList *ioData) {
    if (!_playing || !_play_buffer) {
        // 没有播放，填静音
        for (UInt32 i = 0; i < ioData->mNumberBuffers; i++) {
            memset(ioData->mBuffers[i].mData, 0, ioData->mBuffers[i].mDataByteSize);
        }
        return noErr;
    }

    [_play_lock lock];
    {
        UInt32 framesNeeded = inNumberFrames;
        UInt32 channels = ioData->mBuffers[0].mNumberChannels;

        for (UInt32 i = 0; i < ioData->mNumberBuffers; i++) {
            float *out = (float *)ioData->mBuffers[i].mData;

            for (UInt32 j = 0; j < framesNeeded; j++) {
                if (_play_read_pos != _play_write_pos) {
                    float sample = _play_buffer[_play_read_pos];
                    _play_read_pos = (_play_read_pos + 1) % PLAY_BUFFER_SIZE;

                    // 填充所有声道（mono → stereo 复制）
                    for (UInt32 c = 0; c < channels; c++) {
                        if (i == 0 || c == 0) {
                            out[j * channels + c] = sample;
                        }
                    }
                } else {
                    // buffer 空，填静音
                    for (UInt32 c = 0; c < channels; c++) {
                        out[j * channels + c] = 0.0f;
                    }
                    _playing = false;
                }
            }
        }
    }
    [_play_lock unlock];

    return noErr;
}

// ===== 初始化 =====
bool audio_engine_init(void) {
    if (_vioUnit != NULL) { return true; }

    @try {
        // 录音格式：16kHz / 16bit / mono / Float32（VoiceProcessingIO 要求 Float32）
        memset(&_recordFormat, 0, sizeof(_recordFormat));
        _recordFormat.mSampleRate = 16000.0;
        _recordFormat.mFormatID = kAudioFormatLinearPCM;
        _recordFormat.mFormatFlags = kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked;
        _recordFormat.mFramesPerPacket = 1;
        _recordFormat.mChannelsPerFrame = 1;
        _recordFormat.mBitsPerChannel = 32;
        _recordFormat.mBytesPerFrame = 4;
        _recordFormat.mBytesPerPacket = 4;

        // 播放格式：与录音相同（16kHz / Float32 / mono）
        memcpy(&_playFormat, &_recordFormat, sizeof(_playFormat));

        // 初始化播放 ring buffer
        if (!_play_buffer) {
            _play_buffer = (float *)calloc(PLAY_BUFFER_SIZE, sizeof(float));
        }
        if (!_play_lock) {
            _play_lock = [[NSLock alloc] init];
        }

        NSLog(@"[AUDIO_ENGINE] initialized (VoiceProcessingIO mode)");
        return true;
    } @catch (NSException *exception) {
        NSLog(@"[AUDIO_ENGINE] init exception: %@", exception);
        return false;
    }
}

// ===== 启动 =====
// 创建并启动 VoiceProcessingIO AudioUnit
// 关键：用 kAudioUnitSubType_VoiceProcessingIO 而不是 kAudioUnitSubType_HALOutput
// 系统会隐式设置 voiceChat mode → 走通话通道
bool audio_engine_start(void) {
    if (_vioUnit != NULL && _running) {
        NSLog(@"[AUDIO_ENGINE] already running");
        return true;
    }

    @try {
        // 1. 创建 VoiceProcessingIO AudioUnit
        AudioComponentDescription desc;
        desc.componentType = kAudioUnitType_Output;
        desc.componentSubType = kAudioUnitSubType_VoiceProcessingIO;
        desc.componentManufacturer = kAudioUnitManufacturer_Apple;
        desc.componentFlags = 0;
        desc.componentFlagsMask = 0;

        AudioComponent component = AudioComponentFindNext(NULL, &desc);
        if (!component) {
            NSLog(@"[AUDIO_ENGINE] VoiceProcessingIO component not found");
            return false;
        }

        OSStatus status = AudioComponentInstanceNew(component, &_vioUnit);
        CheckError(status, "AudioComponentInstanceNew");
        if (status != noErr) return false;

        // 2. 启用 Bus 1 (input) - 录音
        UInt32 enableInput = 1;
        status = AudioUnitSetProperty(_vioUnit,
                                      kAudioOutputUnitProperty_EnableIO,
                                      kAudioUnitScope_Input,
                                      1,  // Bus 1 = input
                                      &enableInput,
                                      sizeof(enableInput));
        CheckError(status, "enable input bus");
        if (status != noErr) return false;

        // 3. 启用 Bus 0 (output) - 播放
        UInt32 enableOutput = 1;
        status = AudioUnitSetProperty(_vioUnit,
                                      kAudioOutputUnitProperty_EnableIO,
                                      kAudioUnitScope_Output,
                                      0,  // Bus 0 = output
                                      &enableOutput,
                                      sizeof(enableOutput));
        CheckError(status, "enable output bus");
        if (status != noErr) return false;

        // 4. 设置输入流格式（Bus 1 output scope，告诉 AU 我们要什么格式）
        status = AudioUnitSetProperty(_vioUnit,
                                      kAudioUnitProperty_StreamFormat,
                                      kAudioUnitScope_Output,
                                      1,  // Bus 1 input 的 output scope
                                      &_recordFormat,
                                      sizeof(_recordFormat));
        CheckError(status, "set input stream format");
        if (status != noErr) return false;

        // 5. 设置输出流格式（Bus 0 input scope，告诉 AU 我们给什么格式）
        status = AudioUnitSetProperty(_vioUnit,
                                      kAudioUnitProperty_StreamFormat,
                                      kAudioUnitScope_Input,
                                      0,  // Bus 0 output 的 input scope
                                      &_playFormat,
                                      sizeof(_playFormat));
        CheckError(status, "set output stream format");
        if (status != noErr) return false;

        // 6. 设置录音回调（Bus 1 input）
        AURenderCallbackStruct inputCallbackStruct;
        inputCallbackStruct.inputProc = InputCallback;
        inputCallbackStruct.inputProcRefCon = NULL;
        status = AudioUnitSetProperty(_vioUnit,
                                      kAudioOutputUnitProperty_SetInputCallback,
                                      kAudioUnitScope_Global,
                                      1,
                                      &inputCallbackStruct,
                                      sizeof(inputCallbackStruct));
        CheckError(status, "set input callback");
        if (status != noErr) return false;

        // 7. 设置播放回调（Bus 0 output）
        AURenderCallbackStruct renderCallbackStruct;
        renderCallbackStruct.inputProc = RenderCallback;
        renderCallbackStruct.inputProcRefCon = NULL;
        status = AudioUnitSetProperty(_vioUnit,
                                      kAudioUnitProperty_SetRenderCallback,
                                      kAudioUnitScope_Input,
                                      0,
                                      &renderCallbackStruct,
                                      sizeof(renderCallbackStruct));
        CheckError(status, "set render callback");
        if (status != noErr) return false;

        // 8. 初始化 AudioUnit
        status = AudioUnitInitialize(_vioUnit);
        CheckError(status, "AudioUnitInitialize");
        if (status != noErr) return false;

        // 9. 启动 AudioUnit
        status = AudioOutputUnitStart(_vioUnit);
        CheckError(status, "AudioOutputUnitStart");
        if (status != noErr) {
            AudioUnitUninitialize(_vioUnit);
            return false;
        }

        _running = true;
        NSLog(@"[AUDIO_ENGINE] VoiceProcessingIO started (voice chat mode)");
        return true;
    } @catch (NSException *exception) {
        NSLog(@"[AUDIO_ENGINE] start exception: %@", exception);
        return false;
    }
}

// ===== 录音控制 =====
bool audio_engine_start_recording(AudioCaptureCallback callback) {
    if (!_vioUnit) {
        NSLog(@"[AUDIO_ENGINE] start_recording: not initialized");
        return false;
    }
    _capture_callback = callback;
    NSLog(@"[AUDIO_ENGINE] recording started");
    return true;
}

void audio_engine_stop_recording(void) {
    _capture_callback = NULL;
    NSLog(@"[AUDIO_ENGINE] recording stopped");
}

// ===== 播放 =====
double audio_engine_play_file(const char *path) {
    if (!_vioUnit || !_running) {
        NSLog(@"[AUDIO_ENGINE] play_file: not running");
        return -1;
    }

    @try {
        NSString *filePath = [NSString stringWithUTF8String:path];
        if (!filePath) return -1;
        NSURL *url = [NSURL fileURLWithPath:filePath];
        NSError *error = nil;

        // 用 AVAudioFile 解码 MP3
        AVAudioFile *file = [[AVAudioFile alloc] initForReading:url error:&error];
        if (error) {
            NSLog(@"[AUDIO_ENGINE] open file error: %@", error);
            return -1;
        }

        AVAudioFormat *fileFormat = file.processingFormat;
        AVAudioFrameCount totalFrames = (AVAudioFrameCount)file.length;
        NSLog(@"[AUDIO_ENGINE] file format: %.0f Hz, %d ch, frames: %d",
              fileFormat.sampleRate, (int)fileFormat.channelCount, (int)totalFrames);

        AVAudioPCMBuffer *fileBuffer = [[AVAudioPCMBuffer alloc]
            initWithPCMFormat:fileFormat frameCapacity:totalFrames];
        [file readIntoBuffer:fileBuffer error:&error];
        if (error) {
            NSLog(@"[AUDIO_ENGINE] read error: %@", error);
            return -1;
        }

        // 转成 16kHz / Float32 / mono（与 _playFormat 一致）
        AVAudioFormat *targetFormat = [[AVAudioFormat alloc]
            initWithCommonFormat:AVAudioPCMFormatFloat32
            sampleRate:16000 channels:1 interleaved:NO];

        AVAudioConverter *converter = [[AVAudioConverter alloc]
            initFromFormat:fileFormat toFormat:targetFormat];

        double ratio = 16000.0 / fileFormat.sampleRate;
        AVAudioFrameCount outFrames = (AVAudioFrameCount)(totalFrames * ratio) + 32;
        AVAudioPCMBuffer *outBuffer = [[AVAudioPCMBuffer alloc]
            initWithPCMFormat:targetFormat frameCapacity:outFrames];

        NSError *convertError = nil;
        __block AVAudioFrameCount inputRemaining = totalFrames;
        __block AVAudioFrameCount inputPos = 0;

        [converter convertToBuffer:outBuffer
                              error:&convertError
                  withInputFromBlock:^AVAudioBuffer * _Nullable(AVAudioFrameCount inNumberOfPackets,
                                                                 AVAudioConverterInputStatus * _Nonnull outStatus) {
            if (inputRemaining == 0) {
                *outStatus = AVAudioConverterInputStatus_EndOfStream;
                return nil;
            }
            AVAudioFrameCount toProvide = MIN(inputRemaining, inNumberOfPackets);
            AVAudioPCMBuffer *inputSlice = [[AVAudioPCMBuffer alloc]
                initWithPCMFormat:fileFormat frameCapacity:toProvide];
            inputSlice.frameLength = toProvide;

            if (fileFormat.channelCount == 1) {
                memcpy(inputSlice.floatChannelData[0],
                       fileBuffer.floatChannelData[0] + inputPos,
                       toProvide * sizeof(float));
            } else {
                // 多声道取第一个声道
                for (AVAudioFrameCount i = 0; i < toProvide; i++) {
                    inputSlice.floatChannelData[0][i] = fileBuffer.floatChannelData[0][i];
                }
            }

            inputPos += toProvide;
            inputRemaining -= toProvide;
            *outStatus = AVAudioConverterInputStatus_HaveData;
            return inputSlice;
        }];

        if (convertError) {
            NSLog(@"[AUDIO_ENGINE] convert error: %@", convertError);
            return -1;
        }

        // 写入 ring buffer
        float *samples = outBuffer.floatChannelData[0];
        UInt32 sampleCount = outBuffer.frameLength;
        double duration = (double)sampleCount / 16000.0;

        [_play_lock lock];
        _play_read_pos = 0;
        _play_write_pos = 0;
        for (UInt32 i = 0; i < sampleCount; i++) {
            _play_buffer[_play_write_pos] = samples[i];
            _play_write_pos = (_play_write_pos + 1) % PLAY_BUFFER_SIZE;
        }
        _playing = true;
        [_play_lock unlock];

        NSLog(@"[AUDIO_ENGINE] playing: %s, duration: %.2fs", path, duration);
        return duration;
    } @catch (NSException *exception) {
        NSLog(@"[AUDIO_ENGINE] play_file exception: %@", exception);
        _playing = false;
        return -1;
    }
}

bool audio_engine_is_playing(void) {
    return _playing;
}

void audio_engine_stop(void) {
    [_play_lock lock];
    _playing = false;
    _play_read_pos = 0;
    _play_write_pos = 0;
    [_play_lock unlock];
    NSLog(@"[AUDIO_ENGINE] playback stopped");
}

// ===== 停止引擎 =====
void audio_engine_stop_engine(void) {
    if (_vioUnit && _running) {
        AudioOutputUnitStop(_vioUnit);
        AudioUnitUninitialize(_vioUnit);
        AudioComponentInstanceDispose(_vioUnit);
        _vioUnit = NULL;
        _running = false;
        NSLog(@"[AUDIO_ENGINE] engine stopped");
    }
}


