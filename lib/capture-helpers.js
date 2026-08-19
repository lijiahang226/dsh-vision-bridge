/** Parse a "x,y,width,height" region string into an object, or undefined. */
export function parseRegion(value) {
  if (typeof value !== "string") return undefined;
  const parts = value.split(",").map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return undefined;
  const [x, y, width, height] = parts;
  if (width <= 0 || height <= 0) return undefined;
  return { x, y, width, height };
}

/** A capture is usable only when it is non-blank and large enough to contain real window content. */
export function isUsableCapture(stats) {
  return Boolean(stats && !stats.blank && stats.width >= 100 && stats.height >= 100);
}

/** Parse the trailing JSON emitted by a capture script. */
export function parseCaptureStats(stdout) {
  const text = String(stdout || "").trim();
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      return JSON.parse(lines[i]);
    } catch {
      // keep looking backwards for the JSON line
    }
  }
  return null;
}

/** Ask the user to confirm an external API send. Returns true when approved. */
export async function askUserConfirmation(ctx, agent, signal, message) {
  const svc = ctx?.userQuestions;
  if (!svc?.ask) {
    throw new Error("requireConfirmation is enabled but the userQuestions service is unavailable");
  }
  const answer = await svc.ask({
    questions: [
      {
        id: "confirm-external-vision",
        question: message,
        options: [{ label: "允许发送" }, { label: "取消" }],
      },
    ],
    agent,
    signal,
  });
  const item = answer?.answers?.[0];
  return item?.selected?.includes("允许发送") ?? false;
}

/** Parse multiple JSON lines emitted by a multi-frame capture script. */
export function parseCaptureStatsLines(stdout) {
  const text = String(stdout || "").trim();
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const stats = [];
  for (const line of lines) {
    try {
      stats.push(JSON.parse(line));
    } catch {
      // ignore non-JSON lines
    }
  }
  return stats;
}
