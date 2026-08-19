# dsh-vision-bridge

[中文文档](README.zh.md)

External vision bridge plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

DeepSeek's own models are text-only, and the harness derives every model
request strictly from the session log (`llm/stream` requests must equal the
durable derivation —the agent-loop invariant). This plugin works on the
`agent/pre-step` waterfall, the supported seam where plugin-provided messages
become the durable log:

1. **Auto-understanding (default on)** —when a text-only model is about to
   receive an image, the plugin automatically calls the preset multimodal
   model and replaces the image block with the returned textual understanding.
2. **`analyze_image` tool** —send a local image file or an http(s) image URL
   to the vision endpoint at any time for follow-up questions.
3. **`screen_analyze` tool** —capture the primary screen and automatically
   analyze it with the configured vision model.
4. **Fallback hint** —if auto-understanding fails (or when
   `autoUnderstand: false`), the image is replaced with an exported-file hint
   so the agent can still call `analyze_image`.

## Architecture

```
src/
├── index.js                 # entry: wiring, settings, bridge, tools
├── settings.js               # schema and defaults
├── vision-client.js          # OpenAI-compatible vision API client
├── image-attachments.js      # attachment read/export/data URL helpers
├── image-bridge.js           # agent/pre-step auto-understand/fallback/repair
├── image-analyze-tool.js     # analyze_image tool registration
├── screen-capture.js         # screen capture + auto analysis tool
├── capture-helpers.js        # capture utility functions
├── powershell-scripts.js     # PowerShell script generators
└── client.js                 # Web UI settings section
```

Key features:

- `autoUnderstand` is on by default: the vision model is called during the
  bridge, not just hinted.
- `promptTemplate` lets you customize the default vision prompt.
- In-process result cache avoids duplicate vision calls for the same image.
- Already-logged images are repaired with auto-understanding when enabled.
- Clean separation of vision client, attachment handling, and bridging.
- `analyze_image` and `screen_analyze` tools for on-demand image/screen analysis.
- Local OCR mode and optional send-confirmation for privacy.

## Install

Mount in a profile patch (`$DSH_HOME/profiles/<name>/cordis.patch.yml`):

```yaml
- insert:
    - id: vision-bridge
      name: 'dsh-vision-bridge'
      config:
        baseURL: 'https://api.openai.com/v1'
        apiKeyEnv: 'VISION_API_KEY'
        model: 'gpt-4o-mini'
```

Or hot-install the built package with `dev_install_package` /
`dev_inject_plugin`.

## Config

| Field | Default | Meaning |
|---|---|---|
| `baseURL` | `https://api.openai.com/v1` | OpenAI-compatible API base URL |
| `apiKey` | `''` | API key (takes precedence over env) |
| `apiKeyEnv` | `VISION_API_KEY` | Env var holding the key |
| `model` | `gpt-4o-mini` | Vision model id |
| `maxTokens` | `4096` | Max output tokens |
| `timeoutMs` | `60000` | Per-request timeout |
| `maxImageBytes` | `10MB` | Largest accepted image |
| `description` | default | Tool description shown to the model |
| `enableTextModelBridge` | `true` | Enable bridge for text-only models |
| `autoUnderstand` | `true` | Call the vision model during bridging |
| `promptTemplate` | default | Default vision prompt when no question is present |
| `exportDirectory` | temp | Export dir for bridged images |
| `nativeImageModels` | `[]` | Model ids that receive image blocks directly |
| `allowedImageDirs` | `[]` | When non-empty, `analyze_image` only accepts local images under these directories |
| `deniedImageDirs` | `[]` | Local image paths under these directories are rejected by `analyze_image` |
| `keepScreenshots` | `false` | Keep `screen_analyze` screenshots; by default they are deleted after analysis |
| `includeDiagnostics` | `true` | Include capture diagnostics in `screen_analyze` results |
| `screenshotTtlMs` | `600000` | Screenshot cleanup TTL in milliseconds |
| `localOcr` | `false` | Run Windows OCR locally on screenshots and include recognized text as context |
| `localOnly` | `false` | Never send image/screen content to the external vision API; use local OCR only |
| `requireConfirmation` | `false` | Ask the user to confirm before sending image/screen content to the external vision API |

Key resolution order: `config.apiKey` →DSH credentials service
(`ctx.credentials.resolve(apiKeyEnv)`) →`process.env[apiKeyEnv]` →`process.env.OPENAI_API_KEY`.

## Tool: `analyze_image`

| Arg | Required | Meaning |
|---|---|---|
| `path` | ✅| Image path (absolute, or relative to the current workspace) or http(s) URL; PDF (requires `pdftoppm`) and common videos (requires `ffmpeg`) are supported by converting the first page/frame |
| `question` | —| Optional specific question |
| `detail` | —| `auto` / `low` / `high` resolution hint |

## Tool: `screen_analyze`

Captures a screen/monitor (or a specific window by title) and automatically
analyzes it with the configured vision model. Supports multi-frame dynamic
analysis, multi-monitor capture, region cropping, and a GPU-friendly window
capture fallback.

| Arg | Required | Meaning |
|---|---|---|
| `question` | —| Optional specific question, e.g. "What error is on the terminal?" |
| `window` | —| Optional window title substring; capture only that window (Windows) |
| `frames` | —| Consecutive screenshot count, default 1, max 8; use >1 for dynamic UI |
| `intervalMs` | —| Delay between frames in ms, default 500 |
| `bringToFront` | —| Allow bringing the target window to the foreground when needed (Windows, default false) |
| `autoBringToFront` | —| Default true; only temporarily foregrounds the window when PrintWindow fails, then restores the previous foreground window |
| `monitor` | —| Optional 0-based monitor index for full-screen capture (Windows) |
| `region` | —| Optional `x,y,width,height` sub-rectangle; relative to the window when `window` is set, otherwise absolute screen coordinates |
| `detail` | —| `auto` / `low` / `high` resolution hint |

Examples:

- Window-targeted: `screen_analyze(window: "Calculator", question: "What number is shown?")`
- Dynamic: `screen_analyze(frames: 3, intervalMs: 800, question: "Is this UI changing?")`

Screenshots are saved under `exportDirectory/screenshots` (or the system temp
directory when unset). By default they are deleted immediately after analysis;
set `keepScreenshots: true` to keep them.

The returned text includes capture diagnostics at the end, e.g.:

```text
(capture diagnostics: method=printwindow, foregroundUsed=false)
```

`method` is one of `printwindow` / `screen-region` / `fullscreen` / `native`;
`foregroundUsed` reports whether the plugin temporarily switched the
foreground window.

If direct background-window capture fails, the plugin returns an explicit
message and asks whether to retry with `bringToFront: true`.

## Native Capture Helper

`native/CaptureHelper.cs` is an optional native Windows capture helper.

- **Purpose**: it is the foundation for a faster, more reliable Windows
  screenshot path. It can capture full screens and window regions directly
  from C#, reducing the need to spawn PowerShell for every capture.
- **Current status**: the plugin still uses the PowerShell capture path for
  stability. The native helper is **not invoked at runtime** yet, but the
  source is kept for future integration and for transparency.
- **Build method**:

  ```bash
  bash scripts/build.sh
  ```

  The build script compiles `native/CaptureHelper.cs` into
  `lib/native/CaptureHelper.exe` when a C# compiler (`csc`) is available.
  You can also compile manually on Windows:

  ```bash
  csc /nologo /target:exe /out:lib/native/CaptureHelper.exe \
    /r:System.Drawing.dll /r:System.Windows.Forms.dll \
    native/CaptureHelper.cs
  ```

- The compiled `.exe` is gitignored and not shipped in the package.

## Known Limitations

- **Drag-to-chat image bridging may be blocked by DSH before the plugin runs**:
  DSH checks the model's `inputModalities` before `agent/pre-step`. If the
  current model does not declare image input, DSH rejects the image with
  "current model does not support images" before this plugin can auto-understand
  it. To make drag-to-chat work, the model must declare `input: ["text", "image"]`
  in DSH model config, or DSH core must provide an earlier image-downgrade hook.
- `screen_analyze` may temporarily bring a GPU-rendered window to the foreground
  to capture it (then restores the previous foreground window).
- Screenshots are stored in the system temp directory by default; the plugin
  cleans up screenshots older than 10 minutes.

## License

MIT
