# alis — 住在电脑里的虚拟朋友
Tauri 2 + React 18 + TypeScript + Tailwind CSS + SQLite + DeepSeek API

<directory>
src/                - 前端 React 应用
  components/       - UI 组件 (Avatar, SideNav, LyricStream, InputBar, drawers/)
  stores/           - Zustand 全局状态 (chat, ui, memory, settings)
  lib/              - 核心逻辑 (ai.ts: DeepSeek streaming, db.ts: SQLite)
src-tauri/          - Rust/Tauri 后端
  src/              - main.rs 入口 + lib.rs 插件注册
  icons/            - 应用图标
ui/                 - 设计稿原型 (参考用，非构建产物)
docs/               - 产品文档
</directory>

<config>
package.json        - npm 依赖，scripts: dev/build/tauri
vite.config.ts      - Vite 配置，port 1420，@ 路径别名
tailwind.config.js  - Nocturne 色系 + Inter 字体
tsconfig.json       - TypeScript 严格模式
src-tauri/tauri.conf.json   - 窗口配置 1100x720，SQLite 预加载
src-tauri/Cargo.toml        - tauri + tauri-plugin-sql(sqlite) + serde
</config>

## 架构决策
- **状态**：Zustand 四个 store 分离关注点（chat/ui/memory/settings），不共享 reducer
- **AI**：DeepSeek `/v1/chat/completions` SSE streaming，前端直接 fetch（Tauri CSP 设 null）
- **DB**：tauri-plugin-sql 封装 SQLite，前端通过 `@tauri-apps/plugin-sql` 读写，两张表 messages/memories
- **抽屉**：DrawerPanel 单容器 + activeDrawer 状态驱动，零路由跳转
- **语音**：ASR/TTS 预留接口（豆包，后续接入），InputBar mic 按钮已占位

## 开发
```
npm run tauri dev    # 启动开发模式
npm run build        # 前端构建
npm run tauri build  # 打包桌面应用
```
