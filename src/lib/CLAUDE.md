# lib/
> L2 | 父级: src/CLAUDE.md

## 成员清单
ai.ts: OpenAI-compatible Chat Completions 非流式封装，对外提供 completeChat/completePrompt
aiModels.ts: AI 模型注册表，定义 DeepSeek/阿里 DashScope 的 value→provider/model/baseURL 映射，并按模型 provider 选择独立 API Key
db.ts: SQLite 单例 + 消息/记忆/设置读写，含 message_counter/context_window_size/core_recent_memory 持久化
memory.ts: 记忆蒸馏器，tickAndDistill 每 100 条新消息通过 completePrompt 生成核心最近记忆 + 结构化记忆
persona.ts: 田山角色 prompt 构建，buildTayamaContextPrompt 注入核心最近记忆、按 type 分组注入长期记忆
messageText.ts: 双语文本解析，getDisplayText / splitDisplaySentences / getSpokenText
replyPostprocess.ts: 大模型输出后处理，清洗协议标签后再入库/展示/TTS
asr.ts: 火山 WebSocket ASR 封装
tts.ts: 火山 HTTP TTS 封装
characterVoice.ts: 状态→音色路由表，getVoiceConfig 按 CharacterStatus 返回 resourceId/speaker，在此填写各状态音色参数

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
