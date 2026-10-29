@echo off
chcp 936 >nul
setlocal
title 卸载执行器
set "SLUG=__SLUG__"
set "DST=%LOCALAPPDATA%\XhsHand\%SLUG%"

echo.
echo   小红书助手 · 执行器  卸载
echo   ------------------------------------
echo.
echo   分两步：
echo     1. 打开扩展页（edge://extensions 或 chrome://extensions），
echo        找到「小红书助手 · 执行器」，点「移除」。
echo     2. 回到这个窗口，按任意键，把文件删干净。
echo.
pause

if exist "%DST%" rmdir /s /q "%DST%"
del /q "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\小红书助手-执行器.vbs" >nul 2>nul
echo.
echo   已删掉：%DST%
echo   开机自启也一起撤掉了。
echo   这只手不会再干活了。要用的话，重新双击「装我.bat」。
pause
