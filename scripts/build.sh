#!/bin/bash
# Build dsh-vision-bridge: copy hand-written ESM sources into lib/ and verify.
# No tsc/tsdown needed — host and client are plain JS that DSH loads directly.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

rm -rf lib
mkdir -p lib/vendor

cp src/index.js lib/index.js
cp src/settings.js lib/settings.js
cp src/vision-client.js lib/vision-client.js
cp src/image-attachments.js lib/image-attachments.js
cp src/image-bridge.js lib/image-bridge.js
cp src/image-analyze-tool.js lib/image-analyze-tool.js
cp src/screen-capture.js lib/screen-capture.js
cp src/capture-helpers.js lib/capture-helpers.js
cp src/powershell-scripts.js lib/powershell-scripts.js
cp src/vendor/*.js lib/vendor/
cp src/client.js lib/client.js

# Compile the optional native Windows capture helper when a C# compiler is available.
if command -v csc >/dev/null 2>&1; then
  CSC="csc"
elif command -v csc.exe >/dev/null 2>&1; then
  CSC="csc.exe"
else
  CSC=""
fi
if [ -n "$CSC" ]; then
  mkdir -p lib/native
  "$CSC" /nologo /target:exe /out:lib/native/CaptureHelper.exe \
    /r:System.Drawing.dll /r:System.Windows.Forms.dll \
    native/CaptureHelper.cs
  echo "=== Native helper compiled ==="
else
  echo "=== csc not found; skipping native helper compile ==="
fi

for file in lib/*.js lib/vendor/*.js; do
  node --check "$file"
done

echo "=== Build complete (${PWD}) ==="
ls -la lib lib/vendor
