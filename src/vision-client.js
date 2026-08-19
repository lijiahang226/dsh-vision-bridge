import { attachmentToDataUrl } from "./image-attachments.js";

/**
 * Resolve the API key from config, the DSH credentials service, or the
 * environment. DSH stores secrets in `$DSH_HOME/.credentials.yaml` and exposes
 * them through `ctx.credentials`; prefer that seam over a bare env var so the
 * plugin works without the key being injected into the process environment.
 */
export async function resolveApiKey(config, ctx) {
  if (config.apiKey) return config.apiKey;
  if (config.apiKeyEnv) {
    const credentials = ctx?.get?.("credentials");
    if (credentials) {
      const hit = await credentials.resolve(config.apiKeyEnv);
      if (hit?.value) return hit.value;
    }
    const fromEnv = process.env[config.apiKeyEnv];
    if (fromEnv) return fromEnv;
  }
  return process.env.OPENAI_API_KEY ?? "";
}

function buildEndpoint(baseURL) {
  const base = baseURL.endsWith("/") ? baseURL : `${baseURL}/`;
  return new URL("chat/completions", base);
}

/** Reject plain-HTTP endpoints except loopback, to avoid sending API keys/images in clear. */
function assertSecureEndpoint(baseURL) {
  let url;
  try {
    url = new URL(baseURL);
  } catch {
    throw new Error(`invalid vision endpoint: ${baseURL}`);
  }
  if (url.protocol === "http:") {
    const host = url.hostname;
    if (host !== "localhost" && host !== "127.0.0.1" && host !== "::1") {
      throw new Error(
        `insecure vision endpoint "${baseURL}" is not allowed; use HTTPS or a localhost HTTP endpoint`,
      );
    }
  }
}

/**
 * Call an OpenAI-compatible chat/completions endpoint with one or more
 * image_url parts. `imageUrl` may be a single URL string or an array of URLs
 * (used for multi-frame screen analysis).
 * Returns the textual answer, falling back to reasoning_content when content
 * is empty (common for reasoning models such as mimo-v2.5 / deepseek-r1).
 */
export async function callVision(config, imageUrl, question, detail, signal, ctx) {
  const key = await resolveApiKey(config, ctx);
  if (!key) {
    const creds = ctx?.get?.("credentials");
    throw new Error(
      `vision API key missing: envName=${config.apiKeyEnv || "(none)"}, creds=${Boolean(creds)}, fromEnv=${Boolean(config.apiKeyEnv && process.env[config.apiKeyEnv])}, openaiEnv=${Boolean(process.env.OPENAI_API_KEY)}`,
    );
  }
  assertSecureEndpoint(config.baseURL);

  const imageUrls = Array.isArray(imageUrl) ? imageUrl : [imageUrl];
  const endpoint = buildEndpoint(config.baseURL);
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`vision request timed out after ${config.timeoutMs}ms`)),
    config.timeoutMs,
  );
  const onOuterAbort = () => controller.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", onOuterAbort, { once: true });
  }

  const content = [
    { type: "text", text: question || config.promptTemplate },
    ...imageUrls.map((url) => ({
      type: "image_url",
      image_url: detail ? { url, detail } : { url },
    })),
  ];

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: "user", content }],
        max_tokens: config.maxTokens,
      }),
      signal: controller.signal,
    });

    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const detailText = body?.error?.message ?? response.statusText;
      throw new Error(
        `vision endpoint returned ${response.status}: ${detailText} (endpoint ${endpoint})`,
      );
    }

    const message = body?.choices?.[0]?.message;
    let answer = message?.content ?? "";
    if (!answer.trim()) answer = message?.reasoning_content ?? "";
    if (typeof answer !== "string" || !answer.trim()) {
      throw new Error("vision endpoint returned an empty response");
    }
    return answer.trim();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onOuterAbort);
  }
}

/** Read an attachment and ask the vision model about it. */
export async function describeAttachment(attachment, ctx, config, question, signal) {
  const dataUrl = await attachmentToDataUrl(attachment, ctx, config);
  return callVision(config, dataUrl, question, undefined, signal, ctx);
}
