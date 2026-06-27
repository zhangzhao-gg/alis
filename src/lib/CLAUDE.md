# lib/
> L2 | 父级: src/CLAUDE.md

## 成员清单
ai.ts: DeepSeek SSE streaming 封装，对外提供 streamChat
db.ts: SQLite 单例 + 消息/记忆/设置读写，含 message_counter 计数器持久化
memory.ts: 记忆蒸馏器，tickAndDistill 每 80 条消息触发一次独立 AI 调用生成结构化记忆
persona.ts: 田山角色 prompt 构建，buildTayamaContextPrompt 按 type 分组注入长期记忆
messageText.ts: 双语文本解析，getDisplayText / splitDisplaySentences / getSpokenText
asr.ts: 火山 WebSocket ASR 封装
tts.ts: 火山 HTTP TTS 封装
recorder.ts: 浏览器 16kHz PCM 实时录音

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
