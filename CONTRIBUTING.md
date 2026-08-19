# Contributing

Thanks for your interest in `dsh-vision-bridge`!

## Development

```bash
npm install
npm run build
npm test
```

The build script copies `src/` to `lib/` and optionally compiles the native
Windows capture helper with `csc.exe` when available.

## Code Style

- Plain ESM JavaScript, no TypeScript build step.
- Keep PowerShell script generators in `src/powershell-scripts.js`.
- Pure utilities live in `src/capture-helpers.js`.
- Screen capture logic lives in `src/screen-capture.js`.
- Run `node test/run-tests.js` before submitting changes.

## Testing

```bash
npm test
```

## Pull Requests

- Keep changes focused and backward compatible.
- Update `README.md` / `README.zh.md` when user-facing behavior changes.
- Update `CHANGELOG.md` for notable changes.
- Ensure the plugin still builds and tests pass.
