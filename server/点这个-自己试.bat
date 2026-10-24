@echo off
chcp 936 >nul
cd /d "%~dp0"
title 服务器试用 demo —— 双击就能自己试

echo.
echo  ================================================
echo    服务器试用 demo —— 现场
echo  ================================================
echo.
echo  马上自动给你开好：
echo    ① 一个小黑窗 = 小服务器（网页和账本都归它管，别关）
echo    ② 浏览器打开起始页（一屏问卷）
echo.
echo  推荐试法（这次要看的就一件事：填几道题，AI 真出东西）：
echo    1. 起始页随手答几道题（第 1 题写两句就行，比如你是做什么的）
echo    2. 点「生成我的账号底子」—— 先弹一张领号卡（称呼＋手机号＋自设密码，不用短信）
echo    3. 领完自动接着跑：人设 / 卖点 / 知识库 / 规划，一条链跑出来（生成中四步亮进度）
echo    4. 点「进工作台看完整界面」—— 「诊断 ^& 配置」里就是刚生成的这份
echo.
echo  不想填也行：右上角「不填，先进工作台逛逛」（会先请领个号，领完直接进）——
echo  每个新号的工作台里都预置了一份建材店样例。
echo  一人一个号：顶栏有「退出 / 换账号」；下次打开网址自动还是这个号。
echo  看谁领了号：浏览器开 http://127.0.0.1:8799/admin （本机直开）。
echo  收场：关掉小黑窗和浏览器即可（下次双击本文件会先自动清场）。
echo.

rem 清场：把占着 8799 端口的旧服务器先关掉
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 8799 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }" >nul 2>&1

start "demo 小服务器（别关）" /min cmd /c "node dev-server.mjs"
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:8799/"

echo.
echo  已开好。万一浏览器没弹出来，手动打开：
echo    http://127.0.0.1:8799/
echo.
pause >nul
