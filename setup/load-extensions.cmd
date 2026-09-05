@echo off
rem 一键加载扩展：用 Chrome 打开开发者扩展页并尝试加载本目录下的 extension。
setlocal
set "EXT=%~dp0extension"
start "" chrome --disable-extensions-except="%EXT%" --load-extension="%EXT%"
start "" chrome chrome://extensions
echo 已打开 Chrome 扩展页。请按下方提示操作：
echo  1) 右上角打开「开发者模式」开关
echo  2) 点「加载已解压的扩展程序」，选择本文件夹里的 extension 目录
echo  3) 打开小红书网页，点扩展图标 → 会引导你完成首次设置
pause