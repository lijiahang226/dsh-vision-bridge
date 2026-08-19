/**
 * dsh-vision-bridge — browser half.
 *
 * Adds a "视觉桥" section to the Web UI settings page. It edits the
 * `vision-bridge` settings namespace (API endpoint, key, model, bridge
 * options) through the settings scope transport. Changes hot-apply.
 */
window.__ModuleLoader__.load({
  id: "dsh-vision-bridge",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    var react = require("react");
    var h = react.createElement;

    var CSS =
      ".__vb_root{max-width:640px;display:flex;flex-direction:column;gap:10px}" +
      ".__vb_field{display:flex;flex-direction:column;gap:4px}" +
      ".__vb_label{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary);display:flex;align-items:center;gap:6px}" +
      ".__vb_override{font-size:10px;color:var(--dsw-alias-state-business-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:4px;padding:0 4px}" +
      ".__vb_hint{font-size:11px;color:var(--dsw-alias-label-tertiary)}" +
      ".__vb_input{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:6px 10px;font-size:13px;box-sizing:border-box;width:100%}" +
      ".__vb_row{display:flex;align-items:center;gap:8px}" +
      ".__vb_check{accent-color:var(--dsw-alias-state-business-primary)}" +
      ".__vb_actions{display:flex;gap:8px;align-items:center;margin-top:4px}" +
      ".__vb_btn{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border-radius:8px;padding:6px 14px;font:inherit;font-size:13px;cursor:pointer}" +
      ".__vb_btn:hover:not(:disabled){border-color:var(--dsw-alias-state-business-primary)}" +
      ".__vb_btn:disabled{opacity:.5;cursor:default}" +
      ".__vb_btnPrimary{border-color:var(--dsw-alias-state-business-primary, #3964fe);background:var(--dsw-alias-state-business-primary, #3964fe);color:#fff}" +
      ".__vb_status{font-size:12px;color:var(--dsw-alias-label-tertiary)}" +
      ".__vb_error{font-size:12px;color:var(--dsw-alias-state-error-primary)}" +
      ".__vb_unavailable{font-size:13px;color:var(--dsw-alias-label-tertiary)}";

    var tagId = "dsh-vision-bridge/main.css";
    if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
      var tag = document.createElement("style");
      tag.dataset.plugin = "dsh-vision-bridge";
      tag.dataset.pluginCss = tagId;
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    var NS = "visionBridge";
    var inject = ["slots", "locale", "settingsScope"];
    var zh = {
      nav: "视觉桥",
      intro: "外置多模态模型配置：纯文本模型遇到图片时自动调用该模型理解图片；也可通过 analyze_image 工具手动查看。修改后即时生效。",
      apiKeyHint: "留空保持当前密钥。密钥只写不读，不会回显。",
      maxTokens: "最大输出 Tokens",
      timeoutMs: "请求超时（毫秒）",
      maxImageBytes: "图片大小上限（字节）",
      enableTextModelBridge: "图片桥接（文本模型贴图时启用）",
      autoUnderstand: "自动理解（桥接时直接调用视觉模型，把图片转成文字）",
      promptTemplate: "默认图片理解提示词",
      exportDirectory: "桥接图片导出目录（空 = 系统临时目录）",
      nativeImageModels: "多模态白名单（逗号分隔，这些模型直收图片块）",
      save: "保存",
      reset: "恢复默认",
      saved: "已保存",
      saving: "保存中…",
      error: "保存失败",
      unavailable: "设置命名空间不可用（服务端未注册 vision-bridge 命名空间？）",
      overridden: "已覆盖",
      loading: "加载中…"
    };
    var en = {
      nav: "Vision Bridge",
      intro: "External multimodal model config: text-only models automatically call this model to understand pasted images; you can also use the analyze_image tool manually. Changes apply immediately.",
      apiKeyHint: "Leave blank to keep the current key. The key is write-only and never echoed.",
      maxTokens: "Max output tokens",
      timeoutMs: "Request timeout (ms)",
      maxImageBytes: "Max local image size (bytes)",
      enableTextModelBridge: "Image bridge (enable for text-only models)",
      autoUnderstand: "Auto-understand (call the vision model during bridging and turn images into text)",
      promptTemplate: "Default image understanding prompt",
      exportDirectory: "Bridge export dir (empty = system temp)",
      nativeImageModels: "Multimodal whitelist (comma-separated; these models receive image blocks directly)",
      allowedImageDirs: "Allowed local image directories (comma-separated; empty = no allowlist)",
      deniedImageDirs: "Denied local image directories (comma-separated)",
      keepScreenshots: "Keep screenshots after analysis",
      includeDiagnostics: "Include capture diagnostics in screen_analyze results",
      screenshotTtlMs: "Screenshot cleanup TTL (ms)",
      localOcr: "Run Windows OCR locally on screenshots",
      localOnly: "Never send image/screen content to the external vision API; use local OCR only",
      requireConfirmation: "Ask the user to confirm before sending content to the external vision API",
      save: "Save",
      reset: "Reset",
      saved: "Saved",
      saving: "Saving…",
      error: "Save failed",
      unavailable: "Settings namespace unavailable (vision-bridge namespace not registered server-side?)",
      overridden: "overridden",
      loading: "Loading…"
    };

    var FIELDS = [
      { key: "baseURL", label: "API Base URL", type: "text", placeholder: "https://api.openai.com/v1" },
      { key: "apiKey", label: "API Key", type: "password", secret: true },
      { key: "apiKeyEnv", label: "API Key 环境变量（apiKey 为空时读取）", type: "text" },
      { key: "model", label: "视觉模型", type: "text", placeholder: "gpt-4o-mini" },
      { key: "maxTokens", label: "最大输出 Tokens", type: "number" },
      { key: "timeoutMs", label: "请求超时（毫秒）", type: "number" },
      { key: "maxImageBytes", label: "图片大小上限（字节）", type: "number" },
      { key: "enableTextModelBridge", label: "图片桥接开关", type: "checkbox" },
      { key: "autoUnderstand", label: "自动理解开关", type: "checkbox" },
      { key: "promptTemplate", label: "默认图片理解提示词", type: "text" },
      { key: "exportDirectory", label: "桥接导出目录", type: "text" },
      { key: "nativeImageModels", label: "多模态白名单（逗号分隔）", type: "csv" },
      { key: "allowedImageDirs", label: "允许读取的图片目录（逗号分隔）", type: "csv" },
      { key: "deniedImageDirs", label: "禁止读取的图片目录（逗号分隔）", type: "csv" },
      { key: "keepScreenshots", label: "保留截图文件", type: "checkbox" },
      { key: "includeDiagnostics", label: "返回截图诊断信息", type: "checkbox" },
      { key: "screenshotTtlMs", label: "截图清理时间（毫秒）", type: "number" },
      { key: "localOcr", label: "本地 OCR（Windows）", type: "checkbox" },
      { key: "localOnly", label: "仅本地模式（不发送外部 API）", type: "checkbox" },
      { key: "requireConfirmation", label: "发送前需用户确认", type: "checkbox" }
    ];
    var ZH_HINTS = {
      apiKey: "apiKeyHint",
      maxTokens: "maxTokens",
      timeoutMs: "timeoutMs",
      maxImageBytes: "maxImageBytes",
      enableTextModelBridge: "enableTextModelBridge",
      autoUnderstand: "autoUnderstand",
      promptTemplate: "promptTemplate",
      exportDirectory: "exportDirectory",
      nativeImageModels: "nativeImageModels",
      allowedImageDirs: "allowedImageDirs",
      deniedImageDirs: "deniedImageDirs",
      keepScreenshots: "keepScreenshots",
      includeDiagnostics: "includeDiagnostics",
      screenshotTtlMs: "screenshotTtlMs",
      localOcr: "localOcr",
      localOnly: "localOnly",
      requireConfirmation: "requireConfirmation"
    };

    function VisionSection(props) {
      var t = props.t;
      var scope = props.scope;
      var [snapshot, setSnapshot] = react.useState(function () { return scope.getSnapshot(); });
      var ready = snapshot.status === "ready" && snapshot.value !== void 0;
      var [draft, setDraft] = react.useState({});
      var [busy, setBusy] = react.useState(false);
      var [notice, setNotice] = react.useState(null);
      var [error, setError] = react.useState(null);

      react.useEffect(function () {
        scope.load();
        var alive = true;
        var sync = function () { if (alive) setSnapshot(scope.getSnapshot()); };
        var un = typeof scope.subscribe === "function" ? scope.subscribe(sync) : null;
        return function () { alive = false; if (un) un(); if (scope.dispose) scope.dispose(); };
      }, [scope]);

      react.useEffect(function () {
        if (ready) setDraft(function (prev) { return Object.assign({}, prev, valueToDraft(snapshot.value)); });
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [ready]);

      if (snapshot.status === "unavailable") {
        return h("p", { className: "__vb_unavailable" }, t("unavailable"));
      }
      if (!ready) return h("p", { className: "__vb_status" }, t("loading"));

      var value = snapshot.value;
      var user = snapshot.user || {};

      function fieldDraft(f) {
        if (f.type === "csv") return draft[f.key] !== void 0 ? draft[f.key] : draftToCsv(value[f.key]);
        if (f.type === "checkbox") return draft[f.key] !== void 0 ? draft[f.key] : Boolean(value[f.key]);
        return draft[f.key] !== void 0 ? draft[f.key] : String(value[f.key] ?? "");
      }
      function setField(f, v) {
        setDraft(function (prev) {
          var next = Object.assign({}, prev);
          next[f.key] = v;
          return next;
        });
        setNotice(null);
        setError(null);
      }

      function onSave() {
        setBusy(true); setNotice(null); setError(null);
        var writes = FIELDS.map(function (f) {
          var d = fieldDraft(f);
          if (f.type === "csv") {
            var arr = String(d).split(",").map(function (s) { return s.trim(); }).filter(Boolean);
            var cur = value[f.key] || [];
            if (arr.length === cur.length && arr.every(function (x, i) { return x === cur[i]; })) return Promise.resolve();
            return scope.set(f.key, arr);
          }
          if (f.type === "checkbox") {
            if (Boolean(d) === Boolean(value[f.key])) return Promise.resolve();
            return Boolean(d) ? scope.set(f.key, true) : scope.unset(f.key);
          }
          if (f.type === "password") {
            if (!d) return Promise.resolve();
            if (d === String(value[f.key] ?? "")) return Promise.resolve();
            return scope.set(f.key, d);
          }
          if (String(d) === String(value[f.key] ?? "")) return Promise.resolve();
          if (String(d).trim() === "" && !(f.key in user)) return Promise.resolve();
          return String(d).trim() === "" ? scope.unset(f.key) : scope.set(f.key, f.type === "number" ? Number(d) : d);
        });
        Promise.all(writes).then(function () {
          setBusy(false); setNotice(t("saved"));
          if (scope.load) scope.load();
        }).catch(function (e) {
          setBusy(false); setError(t("error") + ": " + String(e && e.message || e));
        });
      }

      function reseedDraft() {
        if (typeof scope.load === "function") {
          var p = scope.load();
          if (p && typeof p.then === "function") {
            p.then(function () {
              var fresh = scope.getSnapshot();
              if (fresh.status === "ready" && fresh.value !== void 0) setDraft(Object.assign({}, valueToDraft(fresh.value)));
            }).catch(function () {});
            return;
          }
        }
        setTimeout(function () {
          var fresh = scope.getSnapshot();
          if (fresh.status === "ready" && fresh.value !== void 0) setDraft(Object.assign({}, valueToDraft(fresh.value)));
        }, 120);
      }

      function onReset() {
        setBusy(true); setNotice(null); setError(null);
        Promise.all(FIELDS.map(function (f) { return scope.unset(f.key); })).then(function () {
          setBusy(false); setNotice(t("saved"));
          reseedDraft();
        }).catch(function (e) {
          setBusy(false); setError(t("error") + ": " + String(e && e.message || e));
        });
      }

      return h("div", { className: "__vb_root" },
        h("p", { className: "__vb_hint", style: { margin: "0 0 4px" } }, t("intro")),
        FIELDS.map(function (f) {
          var overridden = f.key in user;
          if (f.type === "checkbox") {
            return h("label", { key: f.key, className: "__vb_field" },
              h("span", { className: "__vb_row" },
                h("input", { className: "__vb_check", type: "checkbox", checked: Boolean(fieldDraft(f)), onChange: function (e) { setField(f, e.target.checked); } }),
                h("span", { className: "__vb_label" }, labelOf(f)),
                overridden ? h("span", { className: "__vb_override" }, t("overridden")) : null
              ),
              f.key in ZH_HINTS ? h("span", { className: "__vb_hint" }, t(ZH_HINTS[f.key])) : null
            );
          }
          return h("label", { key: f.key, className: "__vb_field" },
            h("span", { className: "__vb_label" },
              labelOf(f),
              overridden ? h("span", { className: "__vb_override" }, t("overridden")) : null
            ),
            h("input", {
              className: "__vb_input",
              type: f.type === "password" ? "password" : f.type === "number" ? "number" : "text",
              value: fieldDraft(f),
              placeholder: f.type === "password" ? (overridden ? "••••••••" : t("apiKeyHint")) : (f.placeholder || ""),
              onChange: function (e) { setField(f, e.target.value); }
            }),
            f.key in ZH_HINTS ? h("span", { className: "__vb_hint" }, t(ZH_HINTS[f.key])) : null
          );
        }),
        h("div", { className: "__vb_actions" },
          h("button", { type: "button", className: "__vb_btn __vb_btnPrimary", onClick: onSave, disabled: busy || !snapshot.writable }, t("save")),
          h("button", { type: "button", className: "__vb_btn", onClick: onReset, disabled: busy || !snapshot.writable }, t("reset")),
          notice ? h("span", { className: "__vb_status" }, notice) : null,
          busy ? h("span", { className: "__vb_status" }, t("saving")) : null,
          error ? h("span", { className: "__vb_error" }, error) : null
        )
      );
    }

    function labelOf(f) {
      return f.label;
    }
    function valueToDraft(value) {
      var out = {};
      for (var i = 0; i < FIELDS.length; i += 1) {
        var f = FIELDS[i];
        out[f.key] = f.type === "csv" ? draftToCsv(value[f.key]) : f.type === "checkbox" ? Boolean(value[f.key]) : String(value[f.key] ?? "");
      }
      return out;
    }
    function draftToCsv(arr) {
      return Array.isArray(arr) ? arr.join(", ") : String(arr ?? "");
    }

    function apply(ctx) {
      var t = ctx.locale.bind(NS);
      ctx.effect(function () { return ctx.locale.register(NS, { zh: zh, en: en }); }, "dsh-vision-bridge: dictionaries");
      var scope = ctx.settingsScope.bind({ namespace: "vision-bridge" });
      ctx.slots.inject("settings.section", function () {
        return ctx.slots.register({
          name: "settings.section",
          id: "vision-bridge",
          order: 25,
          label: function () { return t("nav"); },
          locale: NS
        }, function (props) {
          return h(VisionSection, Object.assign({}, props, { scope: scope }));
        });
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
