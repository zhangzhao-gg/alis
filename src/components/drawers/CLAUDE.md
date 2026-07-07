# drawers/
> L2 | 父级: src/CLAUDE.md

成员清单
DrawerPanel.tsx: 抽屉外壳与 activeDrawer 路由，统一滑入/滑出容器
SettingsDrawer.tsx: 设置抽屉，管理 AI 模型、DeepSeek/阿里独立 API Key、TTS、ASR、debug 与危险清理操作
MemoryDrawer.tsx: 记忆抽屉，按 MemoryType 分组展示和删除长期记忆
NotebookDrawer.tsx: 笔记抽屉，搜索与展开历史消息，按显示语言读取双语回复

法则: Panel 只管容器·Drawer 只管本域状态·危险操作必须应用内确认

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
