# 截屏到 视频\截图\，命名 slug.png
param([string]$Name = "shot")
$dir = Join-Path $PSScriptRoot "截图"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$out = Join-Path $dir "$Name.png"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$b = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
$g = [System.Drawing.Graphics]::FromImage($b)
$g.CopyFromScreen(0, 0, 0, 0, $b.Size)
$b.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$b.Dispose(); $g.Dispose()
Write-Output $out