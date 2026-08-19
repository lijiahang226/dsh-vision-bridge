import { defineTool } from "@deepseek-ai/dsh-tools";
import { toImageDataUrl } from "./image-attachments.js";
import { callVision } from "./vision-client.js";
import { askUserConfirmation } from "./capture-helpers.js";
import { runWindowsOcr } from "./screen-capture.js";

/**
 * Register the `analyze_image` tool on the global tools layer. The tool sends
 * a local image or http(s) URL to the configured vision endpoint and returns
 * the model's textual answer.
 */
export function registerImageAnalyzeTool(ctx, getConfig) {
  ctx.tools.register(defineTool({
    name: "analyze_image",
    description: getConfig().description,
    parameters: {
      path: {
        type: "string",
        required: true,
        description: "Path to the image file (absolute, or relative to the current workspace) or an http(s) URL.",
      },
      question: {
        type: "string",
        description: "Optional specific question about the image. Omit for a general detailed description.",
      },
      detail: {
        type: "string",
        enum: ["auto", "low", "high"],
        description: "Optional image resolution hint for the vision API (auto by default).",
      },
    },
    output: {
      schema: { type: "string" },
      render: (_args, value) => [{ type: "text", text: value }],
    },
    async execute(args, exec) {
      const cfg = getConfig();
      const cwd = exec.agent?.session?.header?.cwd ?? process.cwd();
      const { url, note } = await toImageDataUrl(args.path, cwd, cfg);

      if (cfg.localOnly) {
        if (/^https?:\/\//i.test(note)) {
          throw new Error("localOnly mode requires a local image path");
        }
        const text = await runWindowsOcr(note);
        return text.trim() || "No text recognized by local OCR.";
      }

      if (cfg.requireConfirmation) {
        const ok = await askUserConfirmation(
          ctx,
          exec.agent,
          exec.signal,
          `Send this image to the external vision API (${cfg.model})?`,
        );
        if (!ok) return "已取消发送到外部视觉 API。";
      }

      const answer = await callVision(cfg, url, args.question, args.detail, exec.signal, ctx);
      return note === url ? answer : `${answer}\n\n(image: ${note})`;
    },
  }));
}
