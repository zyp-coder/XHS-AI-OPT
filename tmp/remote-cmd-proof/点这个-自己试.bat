@echo off
chcp 936 >nul
cd /d "%~dp0"
title 服务器指挥扩展 · 演示入口

echo.
echo  ==========================================
echo    服务器"隔空指挥"浏览器扩展 · 现场演示
echo  ==========================================
echo.
echo  接下来会自动弹出：
echo   ① 一个最小化的黑窗口 = 服务器（别关它，关了演示就停）
echo   ② Edge 浏览器，里面两个标签：
echo        · 「服务器控制台」← 你在这个页面点按钮
echo        · 「目标页面」  ← 被指挥的那个页面
echo.
echo  玩法：点控制台上的 ① 号按钮，盯着"目标页面"标签的名字——
echo        它会隔空被改掉；每一步都带时间戳记在控制台的证据流里。
echo        ② / ③ 号按钮分别试试"报告标签页"和"开新标签页"。
echo.
echo  收场：关掉浏览器窗口，再把任务栏里那个黑窗口关掉，就干净了。
echo.

rem 先清掉上一次没关干净的东西（演示专用浏览器 + 占着 8798 端口的旧服务）
powershell -NoProfile -ExecutionPolicy Bypass -File kill-demo-browser.ps1 >nul 2>&1
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 8798 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }" >nul 2>&1

start "服务器（别关我）" /min cmd /c "node proof-server.mjs"
timeout /t 2 /nobreak >nul

start "" "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --user-data-dir="%~dp0.profile-play" --disable-extensions-except="%~dp0proof-extension" --load-extension="%~dp0proof-extension" --no-first-run --no-default-browser-check --disable-features=msEdgeFirstRunExperience "http://127.0.0.1:8798/demo-page.html" "http://127.0.0.1:8798/control.html"

echo.
echo  已开好（浏览器等两三秒才弹出来是正常的）。
echo  这个说明窗口现在可以关掉了。
echo.
pause >nul
