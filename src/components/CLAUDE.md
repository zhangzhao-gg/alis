# components/
> L2 | 父级: src/CLAUDE.md

成员清单
Avatar/: 中央头像模块，按角色状态与表情资源渲染视觉焦点
InputBar/: 底部输入模块，统一文字发送、AI 回复、语音通话、ASR/VAD/TTS 编排
LyricStream/: 对话展示模块，按语言与语音模式呈现歌词式消息流
SideNav/: 左侧导航模块，控制记忆、笔记、设置抽屉开关
drawers/: 抽屉模块，承载设置、记忆、笔记三类侧边面板
DebugOverlay.tsx: 调试浮窗，消费 debugLog store 展示运行时日志

法则: 组件只编排交互·业务能力下沉 lib·全局事实来自 stores

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
