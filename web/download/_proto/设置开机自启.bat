@echo off
chcp 936 >nul
setlocal
title 小红书助手 · 执行器 开机自启
set "DST=%~dp0"
if "%DST:~-1%"=="\" set "DST=%DST:~0,-1%"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "LNK=%STARTUP%\小红书助手-执行器.vbs"
set "BASE=%LOCALAPPDATA%\XhsHand"

echo.
echo   小红书助手 · 执行器   设「开机自启」
echo   ------------------------------------
echo.
echo   它做什么：在系统的「启动」里放一张小卡片，每次开机自己检查一遍、
echo   再把浏览器打开；扩展被浏览器偷偷禁掉也顺手修好。不弹窗，不打扰。
echo   不动你的书签、密码、历史记录。
echo.

if not exist "%DST%\boot-start.vbs" goto novbs
if not exist "%STARTUP%" goto nostartup

rem 开机那张小卡片只认固定位置里装好的执行器，先确认那儿确实有一份
set "FOUND="
for /d %%D in ("%BASE%\*") do if exist "%%~fD\manifest.json" if not defined FOUND set "FOUND=%%~fD"
if not defined FOUND goto noinstall

copy /y "%DST%\boot-start.vbs" "%LNK%" >nul 2>nul
if not exist "%LNK%" goto copyfail

echo   [OK] 设好了。以后开机它会自己跑，不用你管。
echo        开机后它检查的是这一份：
echo        %FOUND%
echo.
echo   想取消：把这一张删掉就行 ——
echo   %LNK%
goto end

:noinstall
echo   [!] 固定位置里没找到装好的执行器：
echo       %BASE%
echo.
echo   这个文件夹里的文件是全的，只是没按说明第 2 步挪到上面那个位置。
echo     给客户装的：按第 2 步挪进去、扩展加载好，再双击一次本文件。
echo     自己电脑上直接用的：这一项不用设 —— 开机后把浏览器打开，
echo       工具会自己把页面开起来、接着干。
goto end

:novbs
echo   [!] 这个文件夹里没找到 boot-start.vbs，看着不像执行器的文件夹。
echo       把本文件和执行器放在同一个文件夹里，再双击一次。
goto end

:nostartup
echo   [!] 没找到系统的「启动」文件夹，这台电脑跟常见的不太一样。
echo       手动设：地址栏粘 shell:startup 回车，把 boot-start.vbs 拖进去。
goto end

:copyfail
echo   [!] 没放进去（可能被杀毒软件拦了一下）。再双击一次；还不行就找发给你的人。
goto end

:end
echo.
pause
exit /b 0
