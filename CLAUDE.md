# yamada — 住在电脑里的虚拟朋友
Tauri 2 + React 18 + TypeScript + Tailwind CSS + SQLite + OpenAI-compatible LLM API

<directory>
src/                - 前端 React 应用
  components/       - UI 组件 (Avatar, SideNav, LyricStream, InputBar, drawers/)
  stores/           - Zustand 全局状态 (chat, ui, memory, settings)
  lib/              - 核心逻辑 (ai.ts/aiModels.ts: DeepSeek + 阿里 DashScope Chat Completions, db.ts: SQLite)
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
- **AI**：OpenAI-compatible `/chat/completions` 非流式调用，`aiModels.ts` 统一路由 DeepSeek 与阿里 DashScope，前端直接 fetch（Tauri CSP 设 null）
- **DB**：tauri-plugin-sql 封装 SQLite，前端通过 `@tauri-apps/plugin-sql` 读写 messages/memories/settings
- **抽屉**：DrawerPanel 单容器 + activeDrawer 状态驱动，零路由跳转
- **语音**：TTS 使用 Tauri 后端请求火山 HTTP 接口，ASR 使用前端录制 16kHz WAV + Tauri 后端火山 WebSocket

## 桌面应用 UI 约束
- 这是 Tauri 桌面应用，最终目标是 macOS 桌面端，不要依赖浏览器原生弹窗交互。
- 禁止在业务 UI 中使用 `window.confirm` / `confirm` / `window.alert` / `alert` 作为确认或错误提示。
- 需要确认危险操作时，使用应用内 modal/dialog 组件，确保在桌面 WebView 中可见、可控，并符合现有视觉风格。
- 需要提示失败或状态时，优先使用应用内状态文本、toast、modal 或抽屉内错误信息；同时可保留 `console.error` 便于调试。

## 开发
```
npm run tauri dev    # 启动开发模式
npm run build        # 前端构建
npm run tauri build  # 打包桌面应用
```
