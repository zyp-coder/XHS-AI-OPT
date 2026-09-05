@echo off
rem 用 NSIS 把 installer.nsi 编译成 setup.exe（NSIS 是免费软件）
rem 如果已装 NSIS，直接双击本脚本即可；没装会在桌面浏览器打开下载地址。

set "NSIS=C:\Program Files (x86)\NSIS\makensis.exe"
if not exist "%NSIS%" set "NSIS=C:\Program Files\NSIS\makensis.exe"
if not exist "%NSIS%" goto nomsis

"%NSIS%" /V2 "%~dp0installer.nsi"
if errorlevel 1 goto err
echo.
echo 打包成功：当前文件夹下生成「小红书评论助手-setup.exe」
pause
exit /b 0

:nomsis
echo 未检测到 NSIS。请到 https://nsis.sourceforge.io/Download 下载安装后重试。
start https://nsis.sourceforge.io/Download
pause
exit /b 1

:err
echo 打包失败，请确认已安装 NSIS 且本脚本与 installer.nsi 在同一文件夹。
pause
exit /b 1