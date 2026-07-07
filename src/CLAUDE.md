# src/
> L2 | 父级: /CLAUDE.md

成员清单
App.tsx: React 应用根组件，启动 SQLite 数据加载、抽屉布局与主交互界面
main.tsx: ReactDOM 入口，挂载 App 并加载全局样式
index.css: Tailwind 入口与全局视觉 token，定义 Nocturne 桌面界面基调
vite-env.d.ts: Vite 类型声明
components/: UI 组件层，承载 Avatar、InputBar、LyricStream、SideNav、drawers 与调试浮层
stores/: Zustand 状态层，集中管理 chat/ui/memory/settings
lib/: 业务能力层，封装 AI、SQLite、记忆、语音、文本解析与调试日志
assets/: 静态资源层，存放前端直接引用的素材

法则: 入口薄·状态集中·能力下沉·UI 不直连外部协议

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
