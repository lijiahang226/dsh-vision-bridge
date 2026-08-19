# Changelog

## [0.2.0] - 2026-08-19

### Added
- `analyze_image` tool with external vision API support.
- `screen_analyze` tool with multi-frame, multi-monitor, region cropping, and GPU-friendly window capture fallback.
- Automatic image bridging for text-only models via `agent/pre-step`.
- DSH credentials service support for API key resolution.
- Local Windows OCR (`localOcr`) for screenshots.
- PDF first-page and video first-frame support in `analyze_image` (requires `pdftoppm` / `ffmpeg`).
- Path security: `allowedImageDirs` / `deniedImageDirs`.
- Screenshot privacy: delete-after-analysis by default, `keepScreenshots` option, `screenshotTtlMs`.
- Capture diagnostics with `includeDiagnostics` toggle.
- macOS and Linux window-targeted capture (best-effort).
- Multi-frame single-process capture for full-screen and window modes on Windows.
- Native C# capture helper foundation (`native/CaptureHelper.cs`).
- GitHub Actions CI workflow.
- Unit tests for core utilities.

### Changed
- `resolveApiKey` now prefers DSH credentials service.
- `screen_analyze` restores the previous foreground window after temporary foregrounding.
- `autoBringToFront` defaults to true for minimal-disturbance capture.

### Fixed
- VSCode/Chrome GPU window capture returning blank images by adding screen-region fallback.
- Minimized windows being captured as tiny icons by restoring them before capture.
- Missing API key when using DSH `.credentials.yaml`.
