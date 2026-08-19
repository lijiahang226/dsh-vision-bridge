import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { extname, isAbsolute, join, relative, resolve as resolvePath } from "node:path";
import { readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";

const execFileAsync = promisify(execFile);

export const MIME_BY_EXT = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

export const EXT_BY_MEDIA = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

const exportedPaths = new Map();

/** Read an attachment and return its Buffer. */
export async function readAttachment(attachment, ctx) {
  const { data } = await ctx.attachments.readImage(attachment);
  return data;
}

/** Convert an attachment to a base64 data URL. */
export async function attachmentToDataUrl(attachment, ctx, config) {
  const data = await readAttachment(attachment, ctx);
  if (data.byteLength > config.maxImageBytes) {
    throw new Error(
      `image too large: ${data.byteLength} bytes, limit ${config.maxImageBytes}`,
    );
  }
  const mime = attachment.mediaType || "image/png";
  return `data:${mime};base64,${data.toString("base64")}`;
}

/**
 * Export one attachment to disk; returns the file path (cached per process).
 */
export async function exportImage(attachment, ctx, dir) {
  const cached = exportedPaths.get(attachment.attachmentId);
  if (cached) return cached;
  const data = await readAttachment(attachment, ctx);
  const ext = EXT_BY_MEDIA[attachment.mediaType] ?? ".img";
  const safeName = attachment.name
    ? attachment.name
        .replace(/\.[^.]+$/, "")
        .replace(/[^\w\-]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 40)
    : "";
  const base = (safeName ? `${safeName}_` : "") + attachment.attachmentId.slice(0, 12);
  const path = join(dir, `${base}${ext}`);
  await writeFile(path, data);
  exportedPaths.set(attachment.attachmentId, path);
  return path;
}

/** Whether `child` is inside `parent` (both absolute, normalized). */
function isPathInside(child, parent) {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** Enforce `allowedImageDirs` / `deniedImageDirs` for local image paths. */
export function assertPathAllowed(abs, config) {
  const denied = (config.deniedImageDirs ?? []).some(
    (dir) => dir && isPathInside(abs, resolvePath(dir)),
  );
  if (denied) {
    throw new Error(`image path is denied by plugin policy: ${abs}`);
  }

  const allowed = [...(config.allowedImageDirs ?? [])];
  if (config.exportDirectory) allowed.push(config.exportDirectory);
  if (allowed.length > 0) {
    const ok = allowed.some((dir) => dir && isPathInside(abs, resolvePath(dir)));
    if (!ok) {
      throw new Error(`image path is not in allowedImageDirs: ${abs}`);
    }
  }
}

/** Convert the first page of a PDF to a temporary PNG using pdftoppm. */
async function pdfToPng(pdfPath) {
  const outBase = join(os.tmpdir(), `dsh-vision-pdf-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await execFileAsync("pdftoppm", ["-png", "-f", "1", "-l", "1", "-singlefile", pdfPath, outBase], {
    timeout: 20000,
  });
  return `${outBase}.png`;
}

/** Extract the first frame of a video to a temporary PNG using ffmpeg. */
async function videoToPng(videoPath) {
  const outFile = join(os.tmpdir(), `dsh-vision-video-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
  await execFileAsync("ffmpeg", ["-i", videoPath, "-frames:v", "1", "-y", outFile], {
    timeout: 30000,
  });
  return outFile;
}

/** Resolve a tool argument to an image data URL. */
export async function toImageDataUrl(target, cwd, config) {
  if (/^https?:\/\//i.test(target)) return { url: target, note: target };
  const abs = isAbsolute(target) ? target : resolvePath(cwd, target);
  const info = await stat(abs).catch(() => null);
  if (!info) throw new Error(`image not found: ${abs}`);
  assertPathAllowed(abs, config);
  const ext = extname(abs).toLowerCase();
  if (ext === ".pdf") {
    const pngPath = await pdfToPng(abs);
    return toImageDataUrl(pngPath, cwd, { ...config, allowedImageDirs: [], deniedImageDirs: [] });
  }
  if ([".mp4", ".mov", ".avi", ".mkv", ".webm"].includes(ext)) {
    const pngPath = await videoToPng(abs);
    return toImageDataUrl(pngPath, cwd, { ...config, allowedImageDirs: [], deniedImageDirs: [] });
  }
  if (info.size > config.maxImageBytes) {
    throw new Error(
      `image too large: ${abs} (${info.size} bytes, limit ${config.maxImageBytes})`,
    );
  }
  const mime = MIME_BY_EXT[extname(abs).toLowerCase()];
  if (!mime) {
    throw new Error(
      `unsupported image extension: ${abs} (supported: ${Object.keys(MIME_BY_EXT).join(", ")})`,
    );
  }
  const data = await readFile(abs);
  return { url: `data:${mime};base64,${data.toString("base64")}`, note: abs };
}
