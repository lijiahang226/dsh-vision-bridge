import { join } from "node:path";
import os from "node:os";
import { exportImage, toImageDataUrl } from "./image-attachments.js";
import { callVision, describeAttachment } from "./vision-client.js";

/** True when any message carries an image content block or a text image reference. */
export function containsImageBlocks(messages) {
  return (messages ?? []).some((m) => {
    if (!Array.isArray(m?.content)) return false;
    return m.content.some((b) => b?.type === "image" || (b?.type === "text" && extractImageReferences(b.text).length > 0));
  });
}

/** Deep-freeze an acyclic JSON-safe value in place (the harness freezes durable messages). */
export function freezeImmutable(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) {
    for (const item of value) freezeImmutable(item);
    return Object.freeze(value);
  }
  for (const key of Object.keys(value)) freezeImmutable(value[key]);
  return Object.freeze(value);
}

/** Collect all text from a message to use as the vision question. */
export function collectQuestionText(message) {
  const content = message?.content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => b?.type === "text")
    .map((b) => b.text ?? "")
    .join("\n")
    .trim();
}

const IMAGE_REF_RE = /!\[[^\]]*\]\(([^)]+)\)|data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g;

/** Extract markdown image references or data-URL images from a text block. */
export function extractImageReferences(text) {
  const refs = [];
  for (const match of String(text ?? "").matchAll(IMAGE_REF_RE)) {
    const raw = match[0];
    const target = (match[1] || match[0]).trim();
    refs.push({ raw, target });
  }
  return refs;
}

/**
 * Whether the session's current model may receive image blocks directly.
 * Uses only the `nativeImageModels` whitelist —never the model's declared
 * `inputModalities`, because profiles routinely declare `input: [text, image]`
 * on text-only models just to pass the harness admission check.
 */
export async function modelAcceptsImages(agent, config) {
  if (!config.enableTextModelBridge) return true;
  const header = agent?.session?.requestHeader?.();
  const model = header?.config?.model ?? agent?.options?.model;
  if (!model) return false;
  return config.nativeImageModels.includes(model);
}

/** Replace image blocks with exported-file hints (fallback mode). */
export async function convertImageMessagesToHints(messages, ctx, dir) {
  const next = [];
  for (const message of messages) {
    const content = message?.content;
    if (!Array.isArray(content) || !content.some((b) => b?.type === "image")) {
      next.push(message);
      continue;
    }

    const blocks = [];
    for (const block of content) {
      if (block?.type !== "image") {
        blocks.push(block);
        continue;
      }
      const path = await exportImage(block.attachment, ctx, dir);
      const name = block.attachment.name ? ` (${block.attachment.name})` : "";
      blocks.push({
        type: "text",
        text:
          `[User sent an image${name}, exported to: ${path}. ` +
          `Inspect it with the analyze_image tool to see its content.]`,
      });
    }
    next.push(freezeImmutable({ ...message, content: blocks }));
  }
  return next;
}

/** Build a text block that records the vision model's understanding. */
function understandingBlock(attachment, config, answer) {
  const name = attachment.name ? ` (${attachment.name})` : "";
  return {
    type: "text",
    text: `[图片${name}已由视觉模型 ${config.model} 自动理解]\n${answer}`,
  };
}

/** Build a fallback hint block when auto-understanding fails. */
async function fallbackBlock(attachment, ctx, dir) {
  const path = await exportImage(attachment, ctx, dir).catch(() => "");
  const name = attachment.name ? ` (${attachment.name})` : "";
  return {
    type: "text",
    text:
      `[User sent an image${name}${path ? `, exported to: ${path}` : ""}. ` +
      `Inspect it with the analyze_image tool to see its content.]`,
  };
}

/**
 * Replace image blocks with the vision model's textual understanding.
 * Falls back to an analyze_image hint when the vision call fails.
 */
export async function describeImageMessages(messages, ctx, config, dir, signal, cache) {
  const next = [];
  for (const message of messages) {
    const content = message?.content;
    if (!Array.isArray(content) || !content.some((b) => b?.type === "image" || (b?.type === "text" && extractImageReferences(b.text).length > 0))) {
      next.push(message);
      continue;
    }

    const question = collectQuestionText(message);
    const blocks = [];
    for (const block of content) {
      if (block?.type === "image") {
        const attachment = block.attachment;
        const cacheKey = `${attachment.attachmentId}|${config.model}|${question}`;
        try {
          let answer = cache?.get(cacheKey);
          if (answer === undefined) {
            const promise = describeAttachment(attachment, ctx, config, question, signal);
            cache?.set(cacheKey, promise);
            answer = await promise;
            // Keep only successful answers; failed promises are removed below.
            cache?.set(cacheKey, answer);
          }
          blocks.push(understandingBlock(attachment, config, answer));
        } catch (error) {
          cache?.delete(cacheKey);
          ctx.logger?.warn?.(`[vision-bridge] auto-understand failed: ${String(error)}`);
          blocks.push(await fallbackBlock(attachment, ctx, dir));
        }
      } else if (block?.type === "text") {
        const refs = extractImageReferences(block.text ?? "");
        if (refs.length === 0) {
          blocks.push(block);
          continue;
        }
        let text = block.text;
        for (const ref of refs) {
          try {
            const url = ref.target.startsWith("data:")
              ? ref.target
              : (await toImageDataUrl(ref.target, process.cwd(), config)).url;
            const answer = await callVision(config, url, question, undefined, signal, ctx);
            text = text.replace(ref.raw, `[图片已由视觉模型 ${config.model} 自动理解]\n${answer}`);
          } catch (error) {
            ctx.logger?.warn?.(`[vision-bridge] text image auto-understand failed: ${String(error)}`);
            text = text.replace(ref.raw, `[图片无法自动理解，请用 analyze_image 查看: ${ref.target}]`);
          }
        }
        blocks.push({ type: "text", text });
      } else {
        blocks.push(block);
      }
    }
    next.push(freezeImmutable({ ...message, content: blocks }));
  }
  return next;
}

/** Extract the model-visible message from a surface event, or null. */
function surfaceMessageOf(event) {
  switch (event?.type) {
    case "user/message":
      return event.data;
    case "assistant/message":
    case "tool/result":
      return event.data?.message ?? null;
    default:
      return null;
  }
}

/** True when a message carries image blocks or text image references. */
function messageHasImage(message) {
  const content = message?.content;
  return Array.isArray(content) && content.some(
    (b) => b?.type === "image" || (b?.type === "text" && extractImageReferences(b.text).length > 0),
  );
}

/** Append a surface replacement for one repaired event. */
function appendSurfaceReplacement(session, event, repairedMessage) {
  const surfaceOp = { op: "replace", start: event.seq, end: event.seq };
  const sourceEventSeqs = [event.seq];
  if (event.type === "user/message") {
    session.append("user/message", repairedMessage, { surfaceOp, sourceEventSeqs });
  } else if (event.type === "assistant/message") {
    session.append("assistant/message", { ...event.data, message: repairedMessage }, { surfaceOp, sourceEventSeqs });
  } else if (event.type === "tool/result") {
    session.append("tool/result", { ...event.data, message: repairedMessage }, { surfaceOp, sourceEventSeqs });
  }
}

/**
 * Lazily repair image blocks already present in the session log. Each event
 * is rewritten once with a surface `replace`; auto-understanding is used when
 * enabled, otherwise a plain hint is written.
 */
export async function repairStoredImageMessages(ctx, session, exportDir, repaired, config, cache) {
  const events = session.events;
  for (let index = repaired.cursor; index < events.length; index += 1) {
    const event = events[index];
    if (repaired.set.has(event.seq)) {
      repaired.set.add(event.seq);
      continue;
    }

    const message = surfaceMessageOf(event);
    if (!message || !messageHasImage(message)) {
      repaired.set.add(event.seq);
      continue;
    }

    const [repairedMessage] = config.autoUnderstand
      ? await describeImageMessages([message], ctx, config, exportDir, undefined, cache)
      : await convertImageMessagesToHints([message], ctx, exportDir);

    try {
      appendSurfaceReplacement(session, event, repairedMessage);
      ctx.logger.info(`[vision-bridge] repaired logged image at seq ${event.seq} (${session.id})`);
    } catch (error) {
      ctx.logger.debug(`[vision-bridge] skip repair of seq ${event.seq}: ${String(error)}`);
    }
    repaired.set.add(event.seq);
  }
  repaired.cursor = events.length;
}

/**
 * Install the pre-step bridge. One root-level listener serves every agent.
 * New pasted images are auto-understood (or hinted) before they enter the
 * durable log; old logged images are repaired lazily.
 */
export function installImageBridge(ctx, getConfig, exportDir, cache) {
  const repairedBySession = new Map();

  ctx.on("agent/pre-step", async (payload, next) => {
    const decision = await next();
    if (!decision || decision.kind !== "enter") return decision;

    const agent = payload?.agent;
    if (!agent?.session) return decision;

    try {
      const config = getConfig();
      const acceptsImage = await modelAcceptsImages(agent, config);
      if (!acceptsImage) {
        let repaired = repairedBySession.get(agent.session.id);
        if (!repaired) {
          repaired = { set: new Set(), cursor: 0 };
          repairedBySession.set(agent.session.id, repaired);
        }
        await repairStoredImageMessages(
          ctx,
          agent.session,
          exportDir,
          repaired,
          config,
          cache,
        ).catch((error) => {
          ctx.logger.warn(`[vision-bridge] logged-image repair failed: ${String(error)}`);
        });
      }
      if (acceptsImage) return decision;

      const messages = config.autoUnderstand
        ? await describeImageMessages(decision.messages, ctx, config, exportDir, undefined, cache)
        : await convertImageMessagesToHints(decision.messages, ctx, exportDir);

      if (messages.every((message, index) => message === decision.messages[index])) {
        return decision;
      }
      return { ...decision, messages };
    } catch (error) {
      ctx.logger.warn(`[vision-bridge] pre-step bridge failed: ${String(error)}`);
      return decision;
    }
  });
}

/** Compute the export directory from config. */
export function resolveBridgeExportDir(config) {
  return config.exportDirectory || join(os.tmpdir(), "dsh-vision-bridge");
}
