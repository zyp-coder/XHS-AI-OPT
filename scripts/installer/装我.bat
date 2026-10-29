@echo off
chcp 936 >nul
setlocal
title 小红书助手 · 执行器 装机
set "SRC=%~dp0"
if "%SRC:~-1%"=="\" set "SRC=%SRC:~0,-1%"
set "SLUG=__SLUG__"
set "DST=%LOCALAPPDATA%\XhsHand\%SLUG%"

echo.
echo   小红书助手 · 执行器
echo   ------------------------------------
echo.

if exist "%DST%\manifest.json" goto already

echo   [1/6] 放到固定位置……
mkdir "%DST%" 2>nul
robocopy "%SRC%" "%DST%" /E /XF "装我.bat" "更新.bat" "卸载.bat" /NFL /NDL /NJH /NJS /NP >nul
if not exist "%DST%\manifest.json" goto copyfail
echo         已放好：%DST%
echo.

echo   [2/6] 防禁用（浏览器过几次重启会偷偷禁掉手动装的扩展，先把坑填上）……
call :isbusy
if not errorlevel 1 goto repairbusy
if exist "%DST%\repair.ps1" powershell -NoProfile -ExecutionPolicy Bypass -File "%DST%\repair.ps1" >nul 2>nul
echo         已完成。
goto repairdone
:repairbusy
echo         浏览器现在开着，这一步先跳过 —— 下次开机它会自己修好，不用你管。
:repairdone
echo.

echo   [3/6] 设置开机自启……
call :ensure_startup
echo.

echo   [4/6] 文件夹路径已经复制到剪贴板。
powershell -NoProfile -Command "Set-Clipboard -Value '%DST%'" >nul 2>nul
if errorlevel 1 echo %DST%| clip >nul 2>nul
echo.

set "BROWSER="
set "EXTURL=chrome://extensions"
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" set "BROWSER=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not defined BROWSER if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not defined BROWSER goto nobrowser

set "EDGE="
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not defined EDGE if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not defined EDGE goto notedge
if /i not "%BROWSER%"=="%EDGE%" goto notedge
set "EXTURL=edge://extensions"
:notedge

echo   [5/6] 接下来只有两下（在马上打开的扩展页里做）：
echo     ① 打开右上角的「开发者模式」开关
echo     ② 点「加载解压缩的扩展程序」，在选文件夹的窗口里按 Ctrl+V，再点「选择文件夹」
echo.
echo   [6/6] 装好后，点浏览器工具栏上的执行器图标。
echo         配对号已经帮你填好了，点一下「挂上」，变成绿色就是连上了。
echo.
start "" "%BROWSER%" "%EXTURL%"
echo   这个窗口先别关，装完看完再按任意键关掉。
pause
exit /b 0

:already
echo   这台电脑以前装过这个号了。
call :ensure_startup
echo.
echo   要更新：双击「更新.bat」；要重装：先双击「卸载.bat」再回来。
pause
exit /b 0

:copyfail
echo   [失败] 文件没复制成功。
echo   把这整个文件夹换个位置（比如先放到桌面）再双击试试，或者找发给你的人。
pause
exit /b 1

:nobrowser
echo   没找到 Chrome 或 Edge。
echo   请先装其中一个浏览器（推荐 Chrome），再来双击这个文件。
pause
exit /b 1

:ensure_startup
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
if not exist "%STARTUP%" goto startupmissing
if not exist "%DST%\boot-start.vbs" goto startupmissing
copy /y "%DST%\boot-start.vbs" "%STARTUP%\小红书助手-执行器.vbs" >nul 2>nul
if not exist "%STARTUP%\小红书助手-执行器.vbs" goto startupmissing
echo         已设置：开机自动检查并打开浏览器（重启后什么都不用做）
exit /b 0
:startupmissing
echo         没设置开机自启（不影响使用，只是每次开机要自己打开浏览器）
exit /b 0

:isbusy
tasklist /FI "IMAGENAME eq msedge.exe" 2>nul | findstr /I "msedge" >nul
if not errorlevel 1 exit /b 0
tasklist /FI "IMAGENAME eq chrome.exe" 2>nul | findstr /I "chrome" >nul
if not errorlevel 1 exit /b 0
exit /b 1
