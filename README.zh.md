# dsh-vision-bridge

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 外接**多模态视觉理解**的插件。

DeepSeek 自家模型是纯文本的，而 harness 的每次模型请求都**严格从会话日志推导**（`llm/stream` 请求必须与持久化推导一致）。本插件在 `agent/pre-step` 这条受支持的缝上工作：

1. **自动理解（默认开启）**：当文本模型收到图片时，插件在图片进入持久化日志**之前**自动调用预设的 OpenAI 兼容多模态模型，把图片转成文字描述/回答，替换进消息。
2. **`analyze_image` 工具**：随时把本地图片或 http(s) 图片 URL 发给视觉端点，做按需追问。
3. **`screen_analyze` 工具**：自动截取当前屏幕，并直接调用视觉模型识别屏幕内容。
4. **降级提示**：自动理解失败（或 `autoUnderstand: false`）时，把图片替换成导出路径提示，让 Agent 用 `analyze_image` 手动查看。

## 设计

代码按职责拆分，方便维护和测试：

```
src/
├── index.js                 # 插件入口：装配设置、桥接、工具
├── settings.js              # 配置 schema 与默认值
├── vision-client.js         # OpenAI 兼容视觉 API 客户端
├── image-attachments.js     # 附件读取、导出、data URL 转换
├── image-bridge.js          # agent/pre-step 自动理解/降级/旧图修复
├── image-analyze-tool.js    # analyze_image 工具注册
├── screen-capture.js        # 屏幕截图 + 自动识别工具
├── capture-helpers.js       # 截图工具函数
├── powershell-scripts.js    # PowerShell 脚本生成器
└── client.js                # Web 设置面板
```

核心特性：

- `autoUnderstand` 默认开启：直接调用视觉模型，把图片转成文字。
- `promptTemplate`：可自定义无文字提问时的默认视觉提示词。
- 进程内视觉结果缓存，同一张图在同一会话中避免重复调用。
- 旧日志中已存在的图片也会按 `autoUnderstand` 自动理解后修复。
- 模块化拆分，视觉调用、附件处理、桥接逻辑解耦。
- `analyze_image` / `screen_analyze` 工具，支持按需识图和屏幕分析。
- 本地 OCR 模式与发送前确认，保护隐私。

## 安装

在 profile patch（`$DSH_HOME/profiles/<name>/cordis.patch.yml`）里挂载：

```yaml
- insert:
    - id: vision-bridge
      name: 'dsh-vision-bridge'
      config:
        baseURL: 'https://api.openai.com/v1'
        apiKeyEnv: 'VISION_API_KEY'
        model: 'gpt-4o-mini'
```

或使用 `dev_install_package` / `dev_inject_plugin` 热装本仓库构建产物。

## 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `baseURL` | `https://api.openai.com/v1` | OpenAI 兼容 API 基地址 |
| `apiKey` | `''` | API 密钥（优先于环境变量） |
| `apiKeyEnv` | `VISION_API_KEY` | 存放密钥的环境变量名 |
| `model` | `gpt-4o-mini` | 视觉模型 id |
| `maxTokens` | `4096` | 视觉调用最大输出 token |
| `timeoutMs` | `60000` | 单次请求超时 |
| `maxImageBytes` | `10MB` | 图片大小上限 |
| `description` | 默认描述 | `analyze_image` 工具描述 |
| `enableTextModelBridge` | `true` | 文本模型贴图时启用桥接/自动理解 |
| `autoUnderstand` | `true` | 桥接时直接调用视觉模型，把图片转成文字 |
| `promptTemplate` | 默认提示词 | 无文字提问时的视觉提示词 |
| `exportDirectory` | 临时目录 | 桥接图片导出目录 |
| `nativeImageModels` | `[]` | 多模态白名单（这些模型直收图片块） |
| `allowedImageDirs` | `[]` | 非空时，`analyze_image` 只允许读取这些目录下的本地图片 |
| `deniedImageDirs` | `[]` | `analyze_image` 禁止读取这些目录下的本地图片 |
| `keepScreenshots` | `false` | 为 `true` 时保留 `screen_analyze` 截图；默认分析后立即删除 |
| `includeDiagnostics` | `true` | 是否在 `screen_analyze` 返回文本中附带截图诊断信息 |
| `screenshotTtlMs` | `600000` | 截图自动清理时间（毫秒） |
| `localOcr` | `false` | 在 Windows 上对截图运行本地 OCR，并把识别文本作为上下文 |
| `localOnly` | `false` | 仅本地模式：不把图片/屏幕内容发送到外部视觉 API，只用本地 OCR |
| `requireConfirmation` | `false` | 发送图片/屏幕内容到外部视觉 API 前，先询问用户确认 |

密钥解析顺序：`config.apiKey` → DSH credentials 服务（`ctx.credentials.resolve(apiKeyEnv)`）→ `process.env[apiKeyEnv]` → `process.env.OPENAI_API_KEY`。

## 工具：`analyze_image`

| 参数 | 必填 | 含义 |
|---|---|---|
| `path` | ✅ | 图片路径（绝对路径，或相对当前工作区）或 http(s) URL；也支持 PDF（需 `pdftoppm`）和常见视频（需 `ffmpeg`），会取首页/首帧 |
| `question` | – | 可选的具体问题 |
| `detail` | – | `auto` / `low` / `high` 分辨率提示 |

## 工具：`screen_analyze`

自动截取屏幕/显示器（或指定窗口）并调用视觉模型识别，返回屏幕内容理解。支持多帧动态分析、多显示器、区域裁剪和 GPU 窗口截图回退。

| 参数 | 必填 | 含义 |
|---|---|---|
| `question` | – | 可选的具体问题，例如“当前终端里有什么报错？” |
| `window` | – | 可选，窗口标题子串；只截取该窗口（Windows 支持） |
| `frames` | – | 连续截图帧数，默认 1，最大 8；用于动态界面分析 |
| `intervalMs` | – | 多帧之间的间隔毫秒数，默认 500 |
| `bringToFront` | – | 是否允许把目标窗口切到前台再截图（Windows，默认 false） |
| `autoBringToFront` | – | 默认 true；仅在 PrintWindow 截不到内容时临时前置窗口，截图后自动恢复原前台窗口 |
| `monitor` | – | 可选，0 开始的显示器编号；全屏截图时指定显示器（Windows） |
| `region` | – | 可选，`x,y,width,height` 子区域；指定 `window` 时相对窗口，否则为屏幕绝对坐标 |
| `detail` | – | `auto` / `low` / `high` 分辨率提示 |

示例：

- 只看某个程序窗口：`screen_analyze(window: "计算器", question: "当前显示什么数字？")`
- 看加载动画/动态变化：`screen_analyze(frames: 3, intervalMs: 800, question: "这个界面在变化吗？")`

截图会保存到 `exportDirectory/screenshots`（未设置时使用系统临时目录）。默认分析完成后立即删除；设置 `keepScreenshots: true` 可保留截图文件。

返回文本末尾会附带截图诊断信息，例如：

```text
(capture diagnostics: method=printwindow, foregroundUsed=false)
```

`method` 取值：`printwindow` / `screen-region` / `fullscreen` / `native`；`foregroundUsed` 表示本次是否临时切换过前台窗口。

如果后台窗口直接截图失败，插件会返回明确提示，并询问是否允许使用 `bringToFront: true` 把窗口切到前台后重试。

## 原生截图助手（Native Capture Helper）

`native/CaptureHelper.cs` 是一个可选的 Windows 原生截图辅助程序。

- **用途**：作为未来更快、更可靠的 Windows 截图路径的基础。它可以直接用 C# 截取全屏和窗口区域，减少每次截图都启动 PowerShell 的开销。
- **当前状态**：插件目前仍使用 PowerShell 截图路径以保证稳定性。原生助手**暂未在运行时调用**，但源码保留，供后续集成和审计。
- **构建方法**：

  ```bash
  bash scripts/build.sh
  ```

  构建脚本会在检测到 C# 编译器（`csc`）时，把 `native/CaptureHelper.cs` 编译为 `lib/native/CaptureHelper.exe`。
  也可以在 Windows 上手动编译：

  ```bash
  csc /nologo /target:exe /out:lib/native/CaptureHelper.exe \
    /r:System.Drawing.dll /r:System.Windows.Forms.dll \
    native/CaptureHelper.cs
  ```


## 已知限制

- **聊天框拖图自动桥接可能被 DSH 提前拦截**：DSH 在 `agent/pre-step` 之前会检查模型 `inputModalities`，如果当前模型未声明支持图片，会直接提示“当前模型不支持图片”，插件来不及自动理解。要让拖图自动桥接生效，需要让当前模型在 DSH 模型配置中声明 `input: ["text", "image"]`，或由 DSH 核心提供更早的图片降级钩子。
- `screen_analyze` 的窗口截图在部分 GPU 渲染窗口上依赖“临时前置 + 屏幕区域截图”，会短暂切换前台窗口（截完自动恢复）。
- 截图文件默认保存在系统临时目录，插件会清理超过 10 分钟的旧截图。

## License

MIT
