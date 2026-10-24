@echo off
setlocal
title Edge 防禁用小工具 - 小红书助手
echo ============================================
echo   小红书助手 · 执行器   Edge 防禁用小工具
echo ============================================
echo.
echo   什么时候用：
echo     新版 Edge 过几次重启后，可能把手动装的扩展"偷偷禁掉"
echo     （扩展页里显示"已停用"或变灰）。双击本文件修一下就好。
echo.
echo   它做什么：
echo     清掉浏览器拉下来的"实验种子"文件 + 预置"开发者模式"。
echo     只动这两处，不动别的。
echo.

tasklist /FI "IMAGENAME eq msedge.exe" 2>nul | findstr /I "msedge" >nul
if not errorlevel 1 (
  echo   [!] Edge 现在还开着（含后台）。
  echo       请把所有 Edge 窗口关掉；如果任务栏右下角还有 Edge 图标，
  echo       右键退出它。然后再重新双击本文件。
  echo.
  pause
  exit /b 1
)

set "U=%LOCALAPPDATA%\Microsoft\Edge\User Data"
if not exist "%U%" (
  echo   [!] 没找到 Edge 的用户目录：
  echo       %U%
  echo       你可能没用过 Edge —— 那就直接用 Chrome 装（chrome://extensions/），
  echo       一样的三步，不需要这个工具。
  echo.
  pause
  exit /b 1
)

del /q "%U%\Variations*" 2>nul
echo   [1/2] 已清理实验种子（Variations*）

powershell -NoProfile -ExecutionPolicy Bypass -Command "$p = Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\User Data\Default\Preferences'; $dir = Split-Path $p; if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }; if (Test-Path $p) { $o = Get-Content $p -Raw -Encoding UTF8 | ConvertFrom-Json } else { $o = New-Object psobject }; if (-not $o.PSObject.Properties['extensions']) { $o | Add-Member -NotePropertyName extensions -NotePropertyValue (New-Object psobject) }; if (-not $o.extensions.PSObject.Properties['ui']) { $o.extensions | Add-Member -NotePropertyName ui -NotePropertyValue (New-Object psobject) }; $o.extensions.ui | Add-Member -NotePropertyName developer_mode -NotePropertyValue $true -Force; [IO.File]::WriteAllText($p, ($o | ConvertTo-Json -Depth 100 -Compress), (New-Object Text.UTF8Encoding($false)))"
if errorlevel 1 (
  echo   [!] 第 2 步没成功（Edge 的配置文件读不了或格式变了）。
  echo       可以改用 Chrome 装，不需要这个工具。
  echo.
  pause
  exit /b 1
)
echo   [2/2] 已预置"开发者模式"
echo.
echo   好了。现在重新打开浏览器，扩展就不会再被偷偷禁掉了。
echo   如果还不行：把 Edge 里这个扩展删掉，重新"加载解压缩的扩展"一次。
echo.
pause
