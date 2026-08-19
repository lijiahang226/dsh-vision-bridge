import { mkdir } from "node:fs/promises";
import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
import { exposeSettingsNamespace } from "./vendor/dsh-settings-expose.js";
import { Config, NS } from "./settings.js";
import { installImageBridge, resolveBridgeExportDir } from "./image-bridge.js";
import { registerImageAnalyzeTool } from "./image-analyze-tool.js";
import { registerScreenAnalyze } from "./screen-capture.js";

/** Cordis plugin name. */
export const name = "vision-bridge";
/** Services required by this plugin. */
export const inject = ["tools", "attachments"];

export { Config, NS };
export { callVision, resolveApiKey } from "./vision-client.js";
export {
  installImageBridge,
  convertImageMessagesToHints,
  collectQuestionText,
  modelAcceptsImages,
  freezeImmutable,
  containsImageBlocks,
  repairStoredImageMessages,
  describeImageMessages,
} from "./image-bridge.js";
export { registerImageAnalyzeTool } from "./image-analyze-tool.js";
export { analyzeScreen, registerScreenAnalyze } from "./screen-capture.js";

export function apply(ctx, config) {
  // Settings-backed configuration: the composition entry is the base layer,
  // and the Web UI / settings.yaml overlay hot-applies on top.
  let current = config;
  let sourceGetter = null;
  const getConfig = () => (sourceGetter ? sourceGetter() : current);

  installSettingsSection(ctx, settingsNamespace(NS), Config, config, {
    setSource: (getter) => {
      sourceGetter = getter;
    },
    onChange: () => {},
  });

  // Expose the settings namespace to the Web client (idempotent self-heal).
  exposeSettingsNamespace(ctx, NS, ctx.logger);

  // Image bridge: auto-understand or hint images on text-only models.
  const cache = new Map();
  if (getConfig().enableTextModelBridge) {
    const exportDir = resolveBridgeExportDir(getConfig());
    mkdir(exportDir, { recursive: true }).catch(() => {});
    installImageBridge(ctx, getConfig, exportDir, cache);
  }

  // Manual tools: image inspection and screen capture + analysis.
  registerImageAnalyzeTool(ctx, getConfig);
  registerScreenAnalyze(ctx, getConfig);

  ctx.logger?.info?.("[vision-bridge] active (autoUnderstand=" + getConfig().autoUnderstand + ", model=" + getConfig().model + ")");
}
