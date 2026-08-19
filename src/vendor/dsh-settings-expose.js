/**
 * Small host-side helper: make a third-party settings namespace visible in the
 * DSH Web UI. DSH only exposes namespaces listed in an internal allowlist, so
 * this helper patches that allowlist in the installed host file when needed.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, sep } from "node:path";

const ALLOWLIST_PATTERN = /const WEB_SETTINGS_NAMESPACES = \[([\s\S]*?)\];/;

/**
 * Add `namespace` to the Web settings allowlist if it is missing.
 *
 * @param {import("cordis").Context} ctx
 * @param {string} namespace - settings namespace short name.
 * @param {{info?: Function, warn?: Function}} logger
 */
export function exposeSettingsNamespace(ctx, namespace, logger) {
  void ctx;
  const hostFile = locateHostApiProxyFile();
  if (!hostFile) {
    logger?.warn?.(`[settings-expose] unable to locate dsh-host-apiproxy; add "${namespace}" to WEB_SETTINGS_NAMESPACES manually`);
    return;
  }

  let source;
  try {
    source = readFileSync(hostFile, "utf8");
  } catch (error) {
    logger?.warn?.(`[settings-expose] failed to read ${hostFile}: ${String(error)}`);
    return;
  }

  const match = source.match(ALLOWLIST_PATTERN);
  if (!match) {
    logger?.warn?.(`[settings-expose] allowlist pattern not found in ${hostFile}`);
    return;
  }

  if (match[1].includes(`"${namespace}"`)) return;

  const nextSource = source.replace(
    ALLOWLIST_PATTERN,
    (_full, listBody) => {
      const trimmed = listBody.trimEnd();
      const separator = trimmed.endsWith("[") || trimmed.endsWith(",") ? "" : ",";
      return `const WEB_SETTINGS_NAMESPACES = [${trimmed}${separator}\n\t"${namespace}"\n];`;
    },
  );

  if (nextSource === source) {
    logger?.warn?.(`[settings-expose] could not patch ${hostFile}`);
    return;
  }

  try {
    writeFileSync(hostFile, nextSource, "utf8");
    logger?.info?.(`[settings-expose] added "${namespace}" to WEB_SETTINGS_NAMESPACES (${hostFile})`);
  } catch (error) {
    logger?.warn?.(`[settings-expose] write failed: ${String(error)}`);
  }
}

function locateHostApiProxyFile() {
  // Prefer the module already loaded by the host process.
  try {
    const Module = createRequire(import.meta.url)("module");
    const cache = Module._cache ?? {};
    for (const key of Object.keys(cache)) {
      if (key.includes(`${sep}dsh-host-apiproxy${sep}`) && key.endsWith(`${sep}index.js`)) {
        return key;
      }
    }
  } catch {
    // fall through
  }

  // Fallback: resolve relative to @deepseek-ai/dsh-settings.
  try {
    const require = createRequire(import.meta.url);
    const settingsEntry = require.resolve("@deepseek-ai/dsh-settings");
    const candidate = join(dirname(dirname(dirname(settingsEntry))), "dsh-host-apiproxy", "lib", "index.js");
    if (existsSync(candidate)) return candidate;
  } catch {
    // fall through
  }

  return "";
}
