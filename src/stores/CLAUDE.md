# stores/
> L2 | 父级: src/CLAUDE.md

成员清单
index.ts: Zustand 全局状态入口，定义 chat/ui/memory/settings 四个 store；settings 保存 DeepSeek/阿里独立 API Key、模型、语音、ASR 与人设覆盖配置，并兼容旧 apiKey 迁移

法则: 状态集中·事实单一·旧配置只在入口归一化

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
