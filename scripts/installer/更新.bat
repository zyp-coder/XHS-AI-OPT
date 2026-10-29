@echo off
chcp 936 >nul
setlocal
title 更新执行器
set "SRC=%~dp0"
if "%SRC:~-1%"=="\" set "SRC=%SRC:~0,-1%"
set "SLUG=__SLUG__"
set "DST=%LOCALAPPDATA%\XhsHand\%SLUG%"

echo.
echo   小红书助手 · 执行器  更新
echo   ------------------------------------
echo.

if not exist "%DST%\manifest.json" goto notinstalled

robocopy "%SRC%" "%DST%" /E /XF "装我.bat" "更新.bat" "卸载.bat" /NFL /NDL /NJH /NJS /NP >nul
if not exist "%DST%\manifest.json" goto copyfail

echo   文件已经换成新版了。
echo.
echo   顺手补上两样东西：
if exist "%DST%\boot-start.vbs" (
  copy /y "%DST%\boot-start.vbs" "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\小红书助手-执行器.vbs" >nul 2>nul
  echo     · 开机自启（以后重启电脑不用管，它自己会检查并打开浏览器）
) else (
  echo     · 没找到开机自启文件，跳过
)
echo     · 一键修复（扩展被浏览器禁掉时，双击它就能修好）
echo.
echo   最后一下：打开扩展页（edge://extensions 或 chrome://extensions），
echo   找到「小红书助手 · 执行器」，点它卡片下面的「重新加载」。
echo   配对号不用重填，挂线不会掉。
echo.
echo   注意：如果浏览器开着，开机自启要等你下次重启电脑才会真的生效。
pause
exit /b 0

:notinstalled
echo   这台电脑还没装过。先双击同一文件夹里的「装我.bat」。
pause
exit /b 1

:copyfail
echo   [失败] 没换成功。先关掉浏览器再双击一次，或者找发给你的人。
pause
exit /b 1
