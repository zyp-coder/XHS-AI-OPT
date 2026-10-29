@echo off
chcp 936 >nul
setlocal
title 小红书助手 · 执行器 自检修复
set "DST=%~dp0"
if "%DST:~-1%"=="\" set "DST=%DST:~0,-1%"
if /i "%~1"=="/boot" goto boot

echo.
echo   小红书助手 · 执行器   一键修复
echo   ------------------------------------
echo.
echo   它做什么：把这三个小毛病一次性修好——
echo     ① 浏览器把「手动装的扩展」偷偷禁掉（显示「已停用」或变灰）
echo     ② 开发者模式被关掉
echo     ③ 浏览器留下的实验种子文件
echo.
echo   不动你的书签、密码、历史记录。
echo.

call :isbusy
if not errorlevel 1 goto busy

powershell -NoProfile -ExecutionPolicy Bypass -File "%DST%\repair.ps1"
if errorlevel 4 goto failed
if errorlevel 3 goto nobrowser

echo.
echo   ✅ 修好了。现在打开浏览器，点一下工具栏上的执行器图标，
echo      看到 🟢 在线待命 就成了。
echo.
echo   以后不用再管这件事：每次开机它会自己检查、修好、再把浏览器打开。
goto end

:busy
echo   [!] 浏览器现在还开着（含后台）。
echo.
echo       请把所有浏览器窗口关掉 —— 任务栏右下角如果还有 Edge/Chrome 图标，
echo       右键退出它 —— 然后再双击本文件。
echo.
echo       不想关也行：下次重启电脑时它会自己修好，不用你做任何事。
goto end

:nobrowser
echo   [!] 没找到 Edge 或 Chrome 的用户目录。
echo       这个执行器只能装在 Edge 或 Chrome 里；换别的浏览器（360/QQ/搜狗）装不了。
goto end

:failed
echo   [!] 修复没成功（可能是浏览器配置文件正被占用）。
echo       请彻底关掉浏览器后再双击一次；还不行就找发给你的人。
goto end

:end
echo.
pause
exit /b 0

:boot
rem ── 开机静默路径：不弹窗口，修完自己把浏览器打开 ──
rem Edge 默认开「启动增强」：登录时只起后台进程、没有窗口。
rem 这时先关掉这些后台进程再修，否则配置文件会被它们覆盖回去。
powershell -NoProfile -Command "$p=@(Get-Process -Name msedge,chrome -ErrorAction SilentlyContinue); if ($p.Count -eq 0) { exit 2 }; $v=@($p | Where-Object { $_.MainWindowHandle -ne 0 }); if ($v.Count -gt 0) { exit 1 }; $p | Stop-Process -Force -ErrorAction SilentlyContinue; Start-Sleep -Seconds 2; exit 0" >nul 2>nul
if errorlevel 2 goto bootrepair
if errorlevel 1 exit /b 0
ping -n 4 127.0.0.1 >nul
:bootrepair
powershell -NoProfile -ExecutionPolicy Bypass -File "%DST%\repair.ps1" >nul 2>nul
call :launch
exit /b 0

:launch
set "WH="
if exist "%TEMP%\xhs-browser.txt" set /p WH=<"%TEMP%\xhs-browser.txt"
set "EDGEEXE="
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "EDGEEXE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not defined EDGEEXE if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "EDGEEXE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
set "CHROMEEXE="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "CHROMEEXE=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined CHROMEEXE if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "CHROMEEXE=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined CHROMEEXE if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" set "CHROMEEXE=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
if /i "%WH%"=="chrome" if defined CHROMEEXE goto launchchrome
if /i "%WH%"=="edge" if defined EDGEEXE goto launchedge
if defined EDGEEXE goto launchedge
if defined CHROMEEXE goto launchchrome
exit /b 0

:launchedge
start "" /min "%EDGEEXE%"
exit /b 0

:launchchrome
start "" /min "%CHROMEEXE%"
exit /b 0

:isbusy
tasklist /FI "IMAGENAME eq msedge.exe" 2>nul | findstr /I "msedge" >nul
if not errorlevel 1 exit /b 0
tasklist /FI "IMAGENAME eq chrome.exe" 2>nul | findstr /I "chrome" >nul
if not errorlevel 1 exit /b 0
exit /b 1
