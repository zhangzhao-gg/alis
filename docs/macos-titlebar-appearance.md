# macOS 标题栏白边问题记录

## 背景

在 `npm run tauri dev` 启动 macOS 桌面端时，窗口顶部曾出现一条白色或浅灰色区域。这个区域看起来像应用外层多了一圈白边，但实际是 macOS 原生标题栏。

项目的页面内容由 React/Tailwind 渲染，始终使用深色 UI；但标题栏由 Tauri 创建的 macOS `NSWindow` 绘制，不属于 React DOM，也不受 `html.dark`、`body` 背景色或 Tailwind class 直接控制。

## 现象

原始配置中窗口只声明了：

```json
"decorations": true,
"transparent": false
```

含义是使用 macOS 原生窗口装饰和标题栏，并且窗口不透明。但没有显式指定原生窗口主题、标题栏样式或窗口背景色。

结果是：

- React 内容区是深色，因为 `index.html` 中有 `class="dark"`。
- macOS 原生标题栏跟随系统/Tauri 默认 appearance。
- 当系统外观或 Tauri 默认判断为 Light 时，标题栏会变成白色或浅灰色。
- 页面深色和标题栏浅色分裂后，就表现为顶部白边。

这解释了为什么它之前可能偶尔正常：项目没有显式锁定标题栏外观，之前只是默认行为刚好接近深色。

## 排查结论

当前修改区中的 ASR、Settings、AI 后处理等改动没有直接修改窗口外观。它们最多改变 dev 启动或渲染时序，使原本依赖默认行为的问题更容易暴露。

真正的原因是窗口外观配置不完整：

- `decorations: true` 保留了 macOS 原生标题栏。
- 页面深色主题只影响 WebView 内容，不影响原生标题栏。
- 没有 `theme` 时，原生标题栏会跟随系统/Tauri 默认主题。
- 没有 `titleBarStyle: "transparent"` 时，macOS 会绘制自己的标题栏材质色。
- 没有 `backgroundColor` 时，透明或初始化阶段背后的 native/window 背景色不受应用色板控制。

## 最终配置

在 `src-tauri/tauri.conf.json` 的窗口配置中显式加入：

```json
"decorations": true,
"theme": "dark",
"titleBarStyle": "transparent",
"backgroundColor": "#131315",
"transparent": false
```

各字段作用：

- `theme: "dark"`：强制原生窗口使用深色 appearance，避免跟随系统 Light 外观。
- `titleBarStyle: "transparent"`：让 macOS 标题栏背景透明，不再绘制独立的浅色或灰色标题栏材质。
- `backgroundColor: "#131315"`：把 native window/WebView 背景设为应用背景色，使透明标题栏背后与内容区一致。
- `decorations: true`：保留原生红黄绿窗口按钮和基本窗口行为。
- `transparent: false`：窗口本身仍是不透明窗口，不启用真正的透明窗口效果。

## 判断方法

如果再次出现类似问题，先区分白色区域来源：

- 只在顶部，有红黄绿按钮和窗口标题：原生 macOS 标题栏问题。
- 出现在 WebView 内容边缘或首帧闪白：页面根节点、WebView 背景或加载时序问题。

对应排查点：

- 原生标题栏：检查 `theme`、`titleBarStyle`、`backgroundColor`。
- WebView 白底：检查 `html`、`body`、`#root` 是否有全高深色背景兜底。

## 经验

桌面应用不要让原生窗口外观依赖系统默认值。页面主题和原生窗口主题是两套系统，尤其在 macOS 上，深色 WebView 不等于深色标题栏。需要在 Tauri 配置里显式锁住窗口主题和标题栏绘制方式。
