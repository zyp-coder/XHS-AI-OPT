#!/usr/bin/env bash
# 自动跑一遍"服务器远程指挥扩展"证明：
#   起服务 → 开全新的无头 Edge（只装演示小扩展）→ 依次发 3 条命令 → 打印证据链
#   → 再做个反证（关掉浏览器再发一条，没人理、只排队）→ 收拾现场
# 用法：bash run-proof.sh          （无头，全自动）
#       bash run-proof.sh headed   （有头，能亲眼看见浏览器动）
set -e
cd "$(dirname "$0")"
DIR=$(pwd -W)
EXT="$DIR/proof-extension"
EDGE="/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
MODE="${1:-headless}"

# 清场：先关掉上一次遗留的演示浏览器，再把它的临时配置目录删净
powershell -NoProfile -ExecutionPolicy Bypass -File kill-demo-browser.ps1 || true
rm -rf "$DIR/.profile-proof"

node proof-server.mjs > server.out.log 2>&1 &
SERVER_PID=$!

sleep 1

if [ "$MODE" = "headed" ]; then
  "$EDGE" --user-data-dir="$DIR/.profile-proof" --disable-extensions-except="$EXT" --load-extension="$EXT" \
    --no-first-run --no-default-browser-check --disable-features=msEdgeFirstRunExperience \
    "http://127.0.0.1:8798/demo-page.html" &
else
  "$EDGE" --user-data-dir="$DIR/.profile-proof" --disable-extensions-except="$EXT" --load-extension="$EXT" \
    --no-first-run --no-default-browser-check --disable-features=msEdgeFirstRunExperience --headless=new \
    "http://127.0.0.1:8798/demo-page.html" &
fi

echo "…等扩展上线（最多 15 秒）"
for i in $(seq 1 15); do
  if curl -s http://127.0.0.1:8798/log | grep -q '"EXT"'; then break; fi
  sleep 1
done

sleep 2

# 注意：中文 JSON 一律走管道喂给 curl——Git Bash 传给原生 curl.exe 的命令行参数
# 会被转成 GBK，中文会变乱码；从 stdin 进就是原始字节，保真。
post() {
  printf '%s' "$1" | curl -s -X POST http://127.0.0.1:8798/send \
    -H 'Content-Type: application/json' --data-binary @-
}

echo; echo "── 第 1 条命令：改标题 ──"
post '{"text":"改标题|📡 服务器远程改名 ①"}'
sleep 2

echo; echo "── 第 2 条命令：报告当前标签页 ──"
post '{"text":"报告标签页"}'
sleep 2

echo; echo "── 第 3 条命令：开新标签页 ──"
post '{"text":"开新标签页"}'
sleep 2

echo; echo "── 反证：先关掉浏览器（扩展没了），再发一条命令 ──"
powershell -NoProfile -ExecutionPolicy Bypass -File kill-demo-browser.ps1 || true
sleep 2
post '{"text":"改标题|没有扩展 应该没人理我"}'
sleep 1

echo; echo "═══ 证据链（服务器视角，带时间戳）═══"
curl -s http://127.0.0.1:8798/log | node -e "
let s='';
process.stdin.on('data',c=>s+=c).on('end',()=>{
  const rows=JSON.parse(s);
  for (const r of rows) console.log('[' + r.t + '] ' + r.kind.padEnd(4) + ' ' + r.text);
});" | tee "证据链.txt"

kill $SERVER_PID 2>/dev/null || true
echo
echo "完成。现场已收拾干净；证据链存了一份在 证据链.txt。"
