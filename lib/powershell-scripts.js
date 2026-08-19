/** Find the first top-level window whose title contains `title`. */
export function findWindowScript(title) {
  const safeTitle = title.replaceAll("'", "''");
  return `
$proc = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like '*${safeTitle}*' } | Select-Object -First 1
if (-not $proc) { throw "Window not found: ${safeTitle}" }
$hwnd = $proc.MainWindowHandle
`;
}

/** Emit a compact JSON object describing whether a PNG is effectively blank. */
export function statsOutputScript(file) {
  const safeFile = file.replaceAll("'", "''");
  return `
$bmp = New-Object System.Drawing.Bitmap '${safeFile}'
try {
  $unique = New-Object 'System.Collections.Generic.HashSet[int]'
  $nonWhite = 0
  $nonBlack = 0
  $total = 0
  for ($y = 0; $y -lt $bmp.Height; $y += 2) {
    for ($x = 0; $x -lt $bmp.Width; $x += 2) {
      $c = $bmp.GetPixel($x, $y)
      [void]$unique.Add($c.ToArgb())
      if ($c.R -lt 250 -or $c.G -lt 250 -or $c.B -lt 250) { $nonWhite++ }
      if ($c.R -gt 5 -or $c.G -gt 5 -or $c.B -gt 5) { $nonBlack++ }
      $total++
    }
  }
  $nonWhiteRatio = if ($total -gt 0) { $nonWhite / $total } else { 0 }
  $nonBlackRatio = if ($total -gt 0) { $nonBlack / $total } else { 0 }
  $blank = ($unique.Count -le 1) -or ($nonWhiteRatio -lt 0.001) -or ($nonBlackRatio -lt 0.001)
  [pscustomobject]@{
    file = '${safeFile}'
    width = $bmp.Width
    height = $bmp.Height
    uniqueColors = $unique.Count
    nonWhiteRatio = [math]::Round($nonWhiteRatio, 4)
    nonBlackRatio = [math]::Round($nonBlackRatio, 4)
    blank = $blank
  } | ConvertTo-Json -Compress
} finally {
  $bmp.Dispose()
}
`;
}

export function dpiAwareBlock() {
  return `
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class DpiAware {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
"@
[DpiAware]::SetProcessDPIAware() | Out-Null
`;
}

/** PrintWindow capture; emits image stats JSON on stdout. */
export function windowsPrintWindowScript(file, title) {
  return `
${dpiAwareBlock()}
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32Capture {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@
${findWindowScript(title)}
$rect = New-Object Win32Capture+RECT
[Win32Capture]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
$w = $rect.Right - $rect.Left
$h = $rect.Bottom - $rect.Top
if ($w -le 0 -or $h -le 0) { throw "Invalid window bounds" }
$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
$ok = [Win32Capture]::PrintWindow($hwnd, $hdc, 2)
$g.ReleaseHdc($hdc)
if (-not $ok) {
  $g.Dispose(); $bmp.Dispose()
  throw "PrintWindow failed"
}
$bmp.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
${statsOutputScript(file)}
`.trim();
}

/**
 * GPU-friendly screen-region capture: restore/bring the window to the front
 * when requested, then CopyFromScreen the window's on-screen rectangle. This
 * captures actual rendered pixels (VSCode/Chrome) instead of PrintWindow's
 * often-blank bitmap.
 */
export function windowsScreenRegionScript(file, title, bringToFront, region) {
  const regionBlock = region
    ? `
  $rx = ${Number(region.x) || 0}
  $ry = ${Number(region.y) || 0}
  $rw = ${Number(region.width) || 0}
  $rh = ${Number(region.height) || 0}
  if ($rw -le 0 -or $rh -le 0) { throw "Invalid region width/height" }
  $capRect = New-Object System.Drawing.Rectangle ($winRect.Left + $rx), ($winRect.Top + $ry), $rw, $rh
  $capRect = [System.Drawing.Rectangle]::Intersect($capRect, $screenBounds)
  if ($capRect.IsEmpty) { throw "Region is not visible on screen" }
`
    : `$capRect = $clip`;

  return `
${dpiAwareBlock()}
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32Region {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@
${findWindowScript(title)}
$rect = New-Object Win32Region+RECT
[Win32Region]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
$winRect = New-Object System.Drawing.Rectangle $rect.Left, $rect.Top, ($rect.Right - $rect.Left), ($rect.Bottom - $rect.Top)
$screen = [System.Windows.Forms.Screen]::FromHandle($hwnd)
$screenBounds = $screen.Bounds
$clip = [System.Drawing.Rectangle]::Intersect($winRect, $screenBounds)
if ($clip.IsEmpty) { throw "Window is not visible on any screen" }
$bringToFront = ${bringToFront ? "$true" : "$false"}
$prevHwnd = [Win32Region]::GetForegroundWindow()
if ($bringToFront) {
  [Win32Region]::ShowWindow($hwnd, 9) | Out-Null
  [Win32Region]::SetForegroundWindow($hwnd) | Out-Null
  $deadline = (Get-Date).AddMilliseconds(2000)
  while ((Get-Date) -lt $deadline -and [Win32Region]::GetForegroundWindow() -ne $hwnd) {
    Start-Sleep -Milliseconds 100
    [Win32Region]::SetForegroundWindow($hwnd) | Out-Null
  }
  Start-Sleep -Milliseconds 400
}
${regionBlock}
$bmp = New-Object System.Drawing.Bitmap $capRect.Width, $capRect.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($capRect.Left, $capRect.Top, 0, 0, $capRect.Size)
$bmp.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
if ($bringToFront -and $prevHwnd -ne [IntPtr]::Zero -and $prevHwnd -ne $hwnd) {
  [Win32Region]::SetForegroundWindow($prevHwnd) | Out-Null
}
${statsOutputScript(file)}
`.trim();
}

/** Full-screen capture of a selected monitor (0-based index, default primary). */
export function windowsFullScreenScript(file, monitor) {
  const monitorExpr = Number.isInteger(monitor)
    ? `$screen = if ($monitor -ge 0 -and $monitor -lt $screens.Length) { $screens[$monitor] } else { [System.Windows.Forms.Screen]::PrimaryScreen }`
    : `$screen = [System.Windows.Forms.Screen]::PrimaryScreen`;

  return `
${dpiAwareBlock()}
$screens = [System.Windows.Forms.Screen]::AllScreens
$monitor = ${Number.isInteger(monitor) ? monitor : "-1"}
${monitorExpr}
$bounds = $screen.Bounds
$bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$bmp.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
${statsOutputScript(file)}
`.trim();
}

/** Capture multiple full-screen frames in a single PowerShell process. */
export function windowsMultiFrameFullScreenScript(files, intervalMs, monitor) {
  const fileList = files.map((file) => `'${file.replaceAll("'", "''")}'`).join(", ");
  const monitorExpr = Number.isInteger(monitor)
    ? `$screen = if ($monitor -ge 0 -and $monitor -lt $screens.Length) { $screens[$monitor] } else { [System.Windows.Forms.Screen]::PrimaryScreen }`
    : `$screen = [System.Windows.Forms.Screen]::PrimaryScreen`;

  return `
${dpiAwareBlock()}
$files = @(${fileList})
$intervalMs = ${Number(intervalMs) || 0}
$screens = [System.Windows.Forms.Screen]::AllScreens
$monitor = ${Number.isInteger(monitor) ? monitor : "-1"}
${monitorExpr}
$bounds = $screen.Bounds
for ($i = 0; $i -lt $files.Count; $i++) {
  $file = $files[$i]
  $bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
  $bmp.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
  $unique = New-Object 'System.Collections.Generic.HashSet[int]'
  $nonWhite = 0
  $nonBlack = 0
  $total = 0
  for ($y = 0; $y -lt $bmp.Height; $y += 2) {
    for ($x = 0; $x -lt $bmp.Width; $x += 2) {
      $c = $bmp.GetPixel($x, $y)
      [void]$unique.Add($c.ToArgb())
      if ($c.R -lt 250 -or $c.G -lt 250 -or $c.B -lt 250) { $nonWhite++ }
      if ($c.R -gt 5 -or $c.G -gt 5 -or $c.B -gt 5) { $nonBlack++ }
      $total++
    }
  }
  $nonWhiteRatio = if ($total -gt 0) { $nonWhite / $total } else { 0 }
  $nonBlackRatio = if ($total -gt 0) { $nonBlack / $total } else { 0 }
  $blank = ($unique.Count -le 1) -or ($nonWhiteRatio -lt 0.001) -or ($nonBlackRatio -lt 0.001)
  $w = $bmp.Width
  $h = $bmp.Height
  $g.Dispose(); $bmp.Dispose()
  [pscustomobject]@{
    file = $file
    width = $w
    height = $h
    uniqueColors = $unique.Count
    nonWhiteRatio = [math]::Round($nonWhiteRatio, 4)
    nonBlackRatio = [math]::Round($nonBlackRatio, 4)
    blank = $blank
  } | ConvertTo-Json -Compress
  if ($i -lt $files.Count - 1 -and $intervalMs -gt 0) { Start-Sleep -Milliseconds $intervalMs }
}
`.trim();
}

/** Capture multiple window frames in a single PowerShell process. */
export function windowsMultiFrameWindowScript(files, intervalMs, title, bringToFront, region) {
  const fileList = files.map((file) => `'${file.replaceAll("'", "''")}'`).join(", ");
  const regionBlock = region
    ? `
  $rx = ${Number(region.x) || 0}
  $ry = ${Number(region.y) || 0}
  $rw = ${Number(region.width) || 0}
  $rh = ${Number(region.height) || 0}
  if ($rw -le 0 -or $rh -le 0) { throw "Invalid region width/height" }
  $capRect = New-Object System.Drawing.Rectangle ($winRect.Left + $rx), ($winRect.Top + $ry), $rw, $rh
  $capRect = [System.Drawing.Rectangle]::Intersect($capRect, $screenBounds)
  if ($capRect.IsEmpty) { throw "Region is not visible on screen" }
`
    : `$capRect = $clip`;

  return `
${dpiAwareBlock()}
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32MultiWindow {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@
${findWindowScript(title)}
$files = @(${fileList})
$intervalMs = ${Number(intervalMs) || 0}
$bringToFront = ${bringToFront ? "$true" : "$false"}
$prevHwnd = [Win32MultiWindow]::GetForegroundWindow()
if ($bringToFront) {
  [Win32MultiWindow]::ShowWindow($hwnd, 9) | Out-Null
  [Win32MultiWindow]::SetForegroundWindow($hwnd) | Out-Null
  $deadline = (Get-Date).AddMilliseconds(2000)
  while ((Get-Date) -lt $deadline -and [Win32MultiWindow]::GetForegroundWindow() -ne $hwnd) {
    Start-Sleep -Milliseconds 100
    [Win32MultiWindow]::SetForegroundWindow($hwnd) | Out-Null
  }
  Start-Sleep -Milliseconds 400
}
$rect = New-Object Win32MultiWindow+RECT
[Win32MultiWindow]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
$winRect = New-Object System.Drawing.Rectangle $rect.Left, $rect.Top, ($rect.Right - $rect.Left), ($rect.Bottom - $rect.Top)
$screen = [System.Windows.Forms.Screen]::FromHandle($hwnd)
$screenBounds = $screen.Bounds
$clip = [System.Drawing.Rectangle]::Intersect($winRect, $screenBounds)
if ($clip.IsEmpty) { throw "Window is not visible on any screen" }
for ($i = 0; $i -lt $files.Count; $i++) {
  $file = $files[$i]
  ${regionBlock}
  $bmp = New-Object System.Drawing.Bitmap $capRect.Width, $capRect.Height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($capRect.Left, $capRect.Top, 0, 0, $capRect.Size)
  $bmp.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
  $unique = New-Object 'System.Collections.Generic.HashSet[int]'
  $nonWhite = 0
  $nonBlack = 0
  $total = 0
  for ($y = 0; $y -lt $bmp.Height; $y += 2) {
    for ($x = 0; $x -lt $bmp.Width; $x += 2) {
      $c = $bmp.GetPixel($x, $y)
      [void]$unique.Add($c.ToArgb())
      if ($c.R -lt 250 -or $c.G -lt 250 -or $c.B -lt 250) { $nonWhite++ }
      if ($c.R -gt 5 -or $c.G -gt 5 -or $c.B -gt 5) { $nonBlack++ }
      $total++
    }
  }
  $nonWhiteRatio = if ($total -gt 0) { $nonWhite / $total } else { 0 }
  $nonBlackRatio = if ($total -gt 0) { $nonBlack / $total } else { 0 }
  $blank = ($unique.Count -le 1) -or ($nonWhiteRatio -lt 0.001) -or ($nonBlackRatio -lt 0.001)
  $w = $bmp.Width
  $h = $bmp.Height
  $g.Dispose(); $bmp.Dispose()
  [pscustomobject]@{
    file = $file
    width = $w
    height = $h
    uniqueColors = $unique.Count
    nonWhiteRatio = [math]::Round($nonWhiteRatio, 4)
    nonBlackRatio = [math]::Round($nonBlackRatio, 4)
    blank = $blank
  } | ConvertTo-Json -Compress
  if ($i -lt $files.Count - 1 -and $intervalMs -gt 0) { Start-Sleep -Milliseconds $intervalMs }
}
if ($bringToFront -and $prevHwnd -ne [IntPtr]::Zero -and $prevHwnd -ne $hwnd) {
  [Win32MultiWindow]::SetForegroundWindow($prevHwnd) | Out-Null
}
`.trim();
}

/** Windows.Media.Ocr script; prints recognized text to stdout. */
export function windowsOcrScript(file) {
  const safeFile = file.replaceAll("'", "''");
  return `
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($WinRtTask, $ResultType) {
  $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
  $netTask = $asTask.Invoke($null, @($WinRtTask))
  $netTask.Wait(-1) | Out-Null
  $netTask.Result
}
[Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime] | Out-Null
[Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder,Windows.Foundation,ContentType=WindowsRuntime] | Out-Null
$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync('${safeFile}')) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if ($null -eq $engine) { throw 'No OCR engine available' }
$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
$result.Text
`.trim();
}

export function windowsBringToFrontScript(title) {
  return `
${dpiAwareBlock()}
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32Foreground {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
"@
${findWindowScript(title)}
[Win32Foreground]::ShowWindow($hwnd, 9) | Out-Null
[Win32Foreground]::SetForegroundWindow($hwnd) | Out-Null
$deadline = (Get-Date).AddMilliseconds(2000)
while ((Get-Date) -lt $deadline -and [Win32Foreground]::GetForegroundWindow() -ne $hwnd) {
  Start-Sleep -Milliseconds 100
  [Win32Foreground]::SetForegroundWindow($hwnd) | Out-Null
}
Start-Sleep -Milliseconds 400
`.trim();
}
