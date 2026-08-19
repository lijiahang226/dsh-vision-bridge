import z from "@deepseek-ai/schemastery";

/** Settings namespace owned by this plugin. */
export const NS = "vision-bridge";

export const DEFAULT_DESCRIPTION =
  "Use the configured external vision endpoint to inspect an image and return a textual description or answer. " +
  "The image data is sent to that endpoint. Accepts local image paths or http(s) image URLs, " +
  "optionally with a specific question. Use this tool whenever you need to read or extract information " +
  "from image content, because the main chat model is text-only.";

export const Config = z.object({
  /** Base URL of an OpenAI-compatible API, e.g. https://api.openai.com/v1 */
  baseURL: z.string().default("https://api.openai.com/v1"),
  /** API key; takes precedence over apiKeyEnv. Rendered as a write-only secret in the Web UI. */
  apiKey: z.string().default("").role("secret"),
  /** Environment variable holding the API key. */
  apiKeyEnv: z.string().default("VISION_API_KEY"),
  /** Vision model id served by the endpoint. */
  model: z.string().default("gpt-4o-mini"),
  /** Max output tokens for the vision call. */
  maxTokens: z.number().default(4096),
  /** Per-request timeout in milliseconds. */
  timeoutMs: z.number().default(60000),
  /** Largest accepted local/attachment image, in bytes. */
  maxImageBytes: z.number().default(10 * 1024 * 1024),
  /** Tool description shown to the model; overrides the default. */
  description: z.string().default(DEFAULT_DESCRIPTION),
  /** Enable the image bridge for text-only models. */
  enableTextModelBridge: z.boolean().default(true),
  /** Automatically call the vision model during the bridge and replace images with text. */
  autoUnderstand: z.boolean().default(true),
  /** Optional prompt template used when the user message contains no text question. */
  promptTemplate: z.string().default(
    "Describe this image in detail, including all key visual elements, text, and context you can see.",
  ),
  /** Export directory for bridged images; empty = system temp. */
  exportDirectory: z.string().default(""),
  /** Model ids that receive image blocks directly (never bridged). */
  nativeImageModels: z.array(z.string()).default([]),
  /** If non-empty, `analyze_image` only accepts local images under these directories. */
  allowedImageDirs: z.array(z.string()).default([]),
  /** Local image paths under these directories are rejected by `analyze_image`. */
  deniedImageDirs: z.array(z.string()).default([]),
  /** Keep screenshots after analysis instead of deleting them immediately. */
  keepScreenshots: z.boolean().default(false),
  /** Append capture diagnostics to `screen_analyze` results. */
  includeDiagnostics: z.boolean().default(true),
  /** Screenshot cleanup TTL in milliseconds. */
  screenshotTtlMs: z.number().default(10 * 60 * 1000),
  /** Run Windows.Media.Ocr locally on screenshots and include the text as context. */
  localOcr: z.boolean().default(false),
  /** When true, never send image/screen content to the external vision API; use local OCR only. */
  localOnly: z.boolean().default(false),
  /** When true, ask the user to confirm before sending image/screen content to the external vision API. */
  requireConfirmation: z.boolean().default(false),
});
