import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import os from "node:os";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { toImageDataUrl } from "./image-attachments.js";
import { callVision } from "./vision-client.js";
import { askUserConfirmation, isUsableCapture, parseCaptureStats, parseCaptureStatsLines, parseRegion } from "./capture-helpers.js";
import {
  windowsPrintWindowScript,
  windowsScreenRegionScript,
  windowsFullScreenScript,
  windowsMultiFrameFullScreenScript,
  windowsMultiFrameWindowScript,
  windowsOcrScript,
  windowsBringToFrontScript,
} from "./powershell-scripts.js";

const execFileAsync = promisify(execFile);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function captureError(message, code, needsForeground = false, windowTitle = "") {
  const error = new Error(message);
  error.code = code;
  error.needsForeground = needsForeground;
  error.windowTitle = windowTitle;
  return error;
}

/** Run Windows.Media.Ocr on a screenshot and return recognized text. */
export async function runWindowsOcr(file) {
  const script = windowsOcrScript(file);
  const stdout = await runPowerShell(script);
  return String(stdout || "").trim();
}

async function runPowerShell(script) {
  const candidates = ["powershell.exe", "pwsh.exe"];
  let lastError;
  for (const command of candidates) {
    try {
      const { stdout } = await execFileAsync(command, ["-NoProfile", "-NonInteractive", "-Command", script], {
        windowsHide: true,
        timeout: 30000,
        maxBuffer: 1024 * 1024,
      });
      return stdout;
    } catch (error) {
      lastError = error;
      if (error.code === "ENOENT") continue;
      throw error;
    }
  }
  throw lastError ?? new Error("no PowerShell executable found");
}

async function captureWindowsPrintWindow(file, windowTitle) {
  const script = windowsPrintWindowScript(file, windowTitle).replaceAll("$file", `'${file.replaceAll("'", "''")}'`);
  const stdout = await runPowerShell(script);
  return parseCaptureStats(stdout);
}

async function captureWindowsScreenRegion(file, windowTitle, bringToFront, region) {
  const script = windowsScreenRegionScript(file, windowTitle, bringToFront, region)
    .replaceAll("$file", `'${file.replaceAll("'", "''")}'`);
  const stdout = await runPowerShell(script);
  return parseCaptureStats(stdout);
}

async function captureWindowsFullScreen(file, monitor) {
  const script = windowsFullScreenScript(file, monitor).replaceAll("$file", `'${file.replaceAll("'", "''")}'`);
  const stdout = await runPowerShell(script);
  return parseCaptureStats(stdout);
}

async function captureWindowsMultiFrameFullScreen(files, intervalMs, monitor) {
  const script = windowsMultiFrameFullScreenScript(files, intervalMs, monitor);
  const stdout = await runPowerShell(script);
  return parseCaptureStatsLines(stdout);
}

async function captureWindowsMultiFrameWindow(files, intervalMs, windowTitle, bringToFront, region) {
  const script = windowsMultiFrameWindowScript(files, intervalMs, windowTitle, bringToFront, region);
  const stdout = await runPowerShell(script);
  return parseCaptureStatsLines(stdout);
}

async function bringWindowToFront(windowTitle) {
  const script = windowsBringToFrontScript(windowTitle);
  await runPowerShell(script);
}

/** Return the current foreground window handle (0 when unavailable). */
async function getForegroundWindowHandle() {
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32FG {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
"@
[Win32FG]::GetForegroundWindow().ToInt64()
`;
  try {
    const stdout = await runPowerShell(script);
    const value = Number(String(stdout).trim());
    return Number.isFinite(value) ? value : 0;
  } catch (error) {
    console.error("[vision-bridge] getForegroundWindowHandle failed:", error);
    return 0;
  }
}

/** Best-effort restore of a previous foreground window handle. */
async function restoreForegroundWindow(handle) {
  if (!handle) return;
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32FG2 {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
"@
[Win32FG2]::SetForegroundWindow([IntPtr]${handle}) | Out-Null
`;
  try {
    await runPowerShell(script);
  } catch (error) {
    console.error("[vision-bridge] restoreForegroundWindow failed:", error);
  }
}

async function captureWindows(file, windowTitle, bringToFront, region, monitor, autoBringToFront, assumeForeground = false) {
  if (!windowTitle) {
    await captureWindowsFullScreen(file, monitor);
    return { method: "fullscreen", foregroundUsed: false };
  }

  const allowForeground = Boolean(bringToFront) || autoBringToFront || assumeForeground;

  // Strategy 1: PrintWindow without any foreground change (minimal disturbance).
  let stats = null;
  let printError = null;
  try {
    stats = await captureWindowsPrintWindow(file, windowTitle);
  } catch (error) {
    console.error("[vision-bridge] PrintWindow capture failed:", error);
    printError = error;
  }
  if (isUsableCapture(stats)) return { method: "printwindow", foregroundUsed: false };

  // Only now, if permitted, temporarily bring the window to the front.
  if (!allowForeground) {
    if (!stats && printError) throw printError;
    throw captureError(
      `无法直接截取后台窗口“${windowTitle}”：PrintWindow 结果为空或尺寸过小。` +
        `是否允许我先把该窗口切到前台再截图？如果可以，请回复“允许”，或使用 bringToFront: true / autoBringToFront: true 重试。`,
      "NEEDS_FOREGROUND",
      true,
      windowTitle,
    );
  }

  // Strategy 2: temporary foreground + screen-region capture.
  // The PowerShell script restores the previous foreground window afterwards.
  try {
    stats = await captureWindowsScreenRegion(file, windowTitle, !assumeForeground, region);
  } catch (error) {
    console.error("[vision-bridge] screen-region capture failed:", error);
    stats = null;
  }
  if (isUsableCapture(stats)) return { method: "screen-region", foregroundUsed: !assumeForeground };

  // Strategy 3: temporary foreground + full-screen capture as a last resort,
  // then restore the previous foreground window from JS.
  const previous = await getForegroundWindowHandle();
  try {
    await bringWindowToFront(windowTitle);
    const fullStats = await captureWindowsFullScreen(file, monitor);
    if (isUsableCapture(fullStats)) return { method: "fullscreen", foregroundUsed: true };
  } catch (error) {
    console.error("[vision-bridge] full-screen fallback failed:", error);
  } finally {
    await restoreForegroundWindow(previous);
  }

  throw captureError(
    `无法截取窗口“${windowTitle}”：PrintWindow、屏幕区域截图和全屏截图都未得到可用内容。`,
    "CAPTURE_BLANK",
    false,
    windowTitle,
  );
}

async function macWindowId(title) {
  const safeTitle = title.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  const script = `
tell application "System Events"
  set frontProcesses to every process whose visible is true
  repeat with p in frontProcesses
    repeat with w in windows of p
      if name of w contains "${safeTitle}" then return id of w
    end repeat
  end repeat
  return ""
end tell
`;
  const { stdout } = await execFileAsync("osascript", ["-e", script], { timeout: 10000 });
  return String(stdout || "").trim();
}

async function captureMac(file, windowTitle) {
  if (windowTitle) {
    const windowId = await macWindowId(windowTitle);
    if (!windowId) {
      throw new Error(`window not found: ${windowTitle}`);
    }
    await execFileAsync("screencapture", ["-l" + windowId, "-o", file], { timeout: 15000 });
    return;
  }
  await execFileAsync("screencapture", ["-x", file], { timeout: 15000 });
}

async function linuxWindowId(title) {
  const { stdout } = await execFileAsync("xdotool", ["search", "--name", title], { timeout: 10000 });
  const lines = String(stdout || "").trim().split(/\s+/).filter(Boolean);
  return lines[0] || "";
}

async function captureLinux(file, windowTitle) {
  if (windowTitle) {
    const windowId = await linuxWindowId(windowTitle);
    if (!windowId) {
      throw new Error(`window not found: ${windowTitle}`);
    }
    await execFileAsync("import", ["-window", windowId, file], { timeout: 15000 });
    return;
  }
  const commands = [
    ["gnome-screenshot", ["-f", file]],
    ["spectacle", ["-b", "-n", "-o", file]],
    ["import", ["-window", "root", file]],
  ];
  let lastError;
  for (const [command, args] of commands) {
    try {
      await execFileAsync(command, args, { timeout: 15000 });
      return;
    } catch (error) {
      lastError = error;
      if (error.code === "ENOENT") continue;
      throw error;
    }
  }
  throw lastError ?? new Error("no supported screenshot tool found on Linux");
}

async function captureScreenToFile(dir, windowTitle, bringToFront, region, monitor, autoBringToFront, assumeForeground = false) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const suffix = windowTitle
    ? `-${windowTitle.replace(/[^\w\-]+/g, "_").slice(0, 40)}`
    : "";
  const file = join(dir, `screen-${timestamp}${suffix}.png`);
  await mkdir(dir, { recursive: true });

  if (process.platform === "win32") {
    const diag = await captureWindows(file, windowTitle, bringToFront, region, monitor, autoBringToFront, assumeForeground);
    return { file, ...diag };
  } else if (process.platform === "darwin") {
    await captureMac(file, windowTitle);
    return { file, method: "native", foregroundUsed: false };
  } else {
    await captureLinux(file, windowTitle);
    return { file, method: "native", foregroundUsed: false };
  }
}

async function captureFrames(dir, count, intervalMs, windowTitle, bringToFront, region, monitor, autoBringToFront) {
  // Fast path: multiple full-screen frames in a single PowerShell process.
  if (process.platform === "win32" && count > 1 && !windowTitle) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const files = [];
    for (let index = 0; index < count; index += 1) {
      files.push(join(dir, `screen-${timestamp}-${index}.png`));
    }
    await mkdir(dir, { recursive: true });
    const stats = await captureWindowsMultiFrameFullScreen(files, intervalMs, monitor);
    return stats.map((stat, index) => ({
      file: stat?.file || files[index],
      method: "fullscreen",
      foregroundUsed: false,
    }));
  }

  // Fast path: multiple window frames in a single PowerShell process.
  if (process.platform === "win32" && count > 1 && windowTitle) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const suffix = `-${windowTitle.replace(/[^\w\-]+/g, "_").slice(0, 40)}`;
    const files = [];
    for (let index = 0; index < count; index += 1) {
      files.push(join(dir, `screen-${timestamp}-${index}${suffix}.png`));
    }
    await mkdir(dir, { recursive: true });
    const bring = Boolean(bringToFront) || autoBringToFront;
    const stats = await captureWindowsMultiFrameWindow(files, intervalMs, windowTitle, bring, region);
    return stats.map((stat, index) => ({
      file: stat?.file || files[index],
      method: "screen-region",
      foregroundUsed: bring,
    }));
  }

  const captures = [];
  const multiFrameWindow = count > 1 && Boolean(windowTitle);
  const shouldPreForeground = multiFrameWindow && (Boolean(bringToFront) || autoBringToFront);
  let previous = 0;
  let foregrounded = false;

  // For multi-frame window capture, bring the window to the front once and keep
  // it there for the whole sequence, then restore the previous foreground.
  if (shouldPreForeground) {
    previous = await getForegroundWindowHandle();
    try {
      await bringWindowToFront(windowTitle);
      foregrounded = true;
    } catch (error) {
      console.error("[vision-bridge] pre-foreground for multi-frame capture failed:", error);
    }
  }

  try {
    for (let index = 0; index < count; index += 1) {
      if (index > 0 && intervalMs > 0) await sleep(intervalMs);
      const capture = await captureScreenToFile(
        dir,
        windowTitle,
        bringToFront,
        region,
        monitor,
        autoBringToFront,
        foregrounded,
      );
      if (foregrounded) capture.foregroundUsed = true;
      captures.push(capture);
    }
  } finally {
    if (foregrounded) await restoreForegroundWindow(previous);
  }
  return captures;
}

/** Remove screenshot PNGs older than `maxAgeMs` from the capture directory. */
async function cleanupOldScreenshots(dir, maxAgeMs = 10 * 60 * 1000) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const now = Date.now();
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".png")) continue;
      const file = join(dir, entry.name);
      try {
        const info = await stat(file);
        if (now - info.mtimeMs > maxAgeMs) await unlink(file);
      } catch {
        // ignore per-file cleanup errors
      }
    }
  } catch {
    // ignore missing/unreadable capture directory
  }
}

/**
 * Capture screen/window frames and analyze them with the configured vision
 * model. `options.window` captures only the matching window (Windows);
 * `options.frames` captures multiple consecutive frames for dynamic analysis;
 * `options.region` captures a sub-rectangle (relative to the window when
 * `window` is set, otherwise absolute screen coordinates); `options.monitor`
 * selects a 0-based monitor for full-screen capture.
 */
export async function analyzeScreen(config, question, detail, signal, options = {}, ctx) {
  const baseDir = config.exportDirectory || join(os.tmpdir(), "dsh-vision-bridge");
  const captureDir = join(baseDir, "screenshots");
  await cleanupOldScreenshots(captureDir, config.screenshotTtlMs);
  const frames = Math.max(1, Math.min(8, Math.floor(Number(options.frames) || 1)));
  const intervalMs = Math.max(0, Number(options.intervalMs) || 500);
  const windowTitle = options.window?.trim() || "";
  const bringToFront = Boolean(options.bringToFront);
  const autoBringToFront = options.autoBringToFront !== false;
  const region = options.region && typeof options.region === "object" ? options.region : undefined;
  const monitor = Number.isInteger(options.monitor) ? options.monitor : undefined;
  const agent = options.agent;

  const captures = await captureFrames(
    captureDir,
    frames,
    intervalMs,
    windowTitle || undefined,
    bringToFront,
    region,
    monitor,
    autoBringToFront,
  );
  const files = captures.map((capture) => capture.file);
  const urls = [];
  for (const file of files) {
    const { url } = await toImageDataUrl(file, process.cwd(), config);
    urls.push(url);
  }

  let ocrContext = "";
  if (config.localOcr && process.platform === "win32") {
    const parts = [];
    for (const file of files) {
      try {
        const text = await runWindowsOcr(file);
        if (text.trim()) parts.push(`--- ${file} ---\n${text.trim()}`);
      } catch (error) {
        console.error("[vision-bridge] OCR failed:", error);
      }
    }
    if (parts.length) ocrContext = `\n\nOCR text from screenshots:\n${parts.join("\n\n")}`;
  }

  const prompt =
    (question?.trim() ||
    (frames > 1
      ? "These are consecutive screenshots of the same screen/window. Describe what is happening, what changes between frames, and any dynamic UI states you can observe."
      : "Describe the current screen content in detail, including all visible windows, text, UI elements, and context.")) + ocrContext;

  let answer;
  if (config.localOnly) {
    const parts = [];
    for (const file of files) {
      try {
        const text = await runWindowsOcr(file);
        if (text.trim()) parts.push(`--- ${file} ---\n${text.trim()}`);
      } catch (error) {
        console.error("[vision-bridge] local OCR failed:", error);
      }
    }
    answer = parts.length ? parts.join("\n\n") : "No text recognized by local OCR.";
  } else if (config.requireConfirmation) {
    const ok = await askUserConfirmation(
      ctx,
      agent,
      signal,
      `Send ${files.length} screenshot(s) to the external vision API (${config.model})?`,
    );
    answer = ok
      ? await callVision(config, urls, prompt, detail, signal, ctx)
      : "已取消发送到外部视觉 API。";
  } else {
    answer = await callVision(config, urls, prompt, detail, signal, ctx);
  }

  const methods = [...new Set(captures.map((capture) => capture.method).filter(Boolean))].join(",");
  const foregroundUsed = captures.some((capture) => capture.foregroundUsed);
  const diagnostics = config.includeDiagnostics === false
    ? ""
    : `\n\n(capture diagnostics: method=${methods || "unknown"}, foregroundUsed=${foregroundUsed})`;

  // Privacy: delete screenshots after analysis unless the user opts to keep them.
  if (!config.keepScreenshots) {
    await Promise.all(files.map((file) => unlink(file).catch(() => {})));
    return { answer: answer + diagnostics, files: [] };
  }
  return { answer: answer + diagnostics, files };
}

/** Register the `screen_analyze` tool: capture + auto vision understanding. */
export function registerScreenAnalyze(ctx, getConfig) {
  ctx.tools.register(defineTool({
    name: "screen_analyze",
    description:
      "Capture the screen (or a specific window by title) and analyze it with the configured vision model. " +
      "The captured screen/window content is sent to the configured external vision endpoint. " +
      "Supports multiple consecutive frames for dynamic UI analysis. Returns a textual description/answer.",
    parameters: {
      question: {
        type: "string",
        description: "Optional specific question about the screen/window content. Omit for a general detailed description.",
      },
      window: {
        type: "string",
        description: "Optional window title substring to capture only that window (Windows only).",
      },
      frames: {
        type: "number",
        description: "Number of consecutive screenshots to capture (default 1, max 8). Use >1 for dynamic UI analysis.",
      },
      intervalMs: {
        type: "number",
        description: "Delay between frames in milliseconds (default 500).",
      },
      bringToFront: {
        type: "boolean",
        description: "When true, allow bringing the target window to the foreground when needed (Windows only).",
      },
      autoBringToFront: {
        type: "boolean",
        description: "When true (default), the plugin may temporarily bring the target window to the foreground only if necessary, then restore the previous foreground window.",
      },
      monitor: {
        type: "number",
        description: "Optional 0-based monitor index for full-screen capture (Windows only). Defaults to the window's screen or primary screen.",
      },
      region: {
        type: "string",
        description: "Optional sub-rectangle to capture as 'x,y,width,height'. Relative to the window when `window` is set, otherwise absolute screen coordinates.",
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
      try {
        const region = args.region ? parseRegion(args.region) : undefined;
        if (args.region && !region) {
          throw new Error(`Invalid region "${args.region}"; expected x,y,width,height`);
        }
        if (args.monitor !== undefined && !Number.isInteger(args.monitor)) {
          throw new Error(`Invalid monitor "${args.monitor}"; expected an integer`);
        }
        const { answer, files } = await analyzeScreen(cfg, args.question, args.detail, exec.signal, {
          window: args.window,
          frames: args.frames,
          intervalMs: args.intervalMs,
          bringToFront: args.bringToFront,
          autoBringToFront: args.autoBringToFront,
          monitor: args.monitor,
          region,
          agent: exec.agent,
        }, ctx);
        const screenshotNote = files.length > 0
          ? `\n\n(screenshots: ${files.join(", ")})`
          : "\n\n(screenshots deleted after analysis)";
        return answer + screenshotNote;
      } catch (error) {
        if (error?.needsForeground) {
          return error.message;
        }
        throw error;
      }
    },
  }));
}

export { parseRegion, isUsableCapture };
