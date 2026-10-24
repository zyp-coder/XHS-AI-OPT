#!/bin/sh
# ── 小红书 demo · 云服务器安装脚本（阿里云 Linux / Ubuntu / CentOS 通用）──
# 做五件事：①装 Node（阿里云镜像下载，失败换官方源）→ ②装云端出片三件套（无头浏览器/剪辑工具/念稿库）
#          → ③解包到 /opt/xhs-demo → ④开 systemd 常驻（开机自启 + 掉线 3 秒自拉）→ ⑤本机自测并提醒开端口。
# 用法（在服务器上，root）：sh deploy-cloud.sh [安装包路径]
#   默认找同目录的 xhs-demo-cloud.tar.gz；已装过＝升级重装（原账本保留）。
# 云端出片那三样装不上只报 ✗ 不拦装机（网站照跑），装完最后一行会体检给结论。
set -e

PKG="${1:-./xhs-demo-cloud.tar.gz}"
APP=/opt/xhs-demo
NODE_V=22.13.0
PORT_V=80
TTS_V=7.3.1          # 念稿库门槛：2026-10 微软换了进门令牌，老版本念不出声（403）

[ "$(id -u)" = "0" ] || { echo "请用 root 跑：sudo sh $0"; exit 1; }
[ -f "$PKG" ] || { echo "找不到安装包：$PKG"; exit 1; }

# ── 1. Node（要 20 及以上；机器上已有新版的就用它的） ──
if command -v node >/dev/null 2>&1 && node -e 'process.exit(Number(process.versions.node.split(".")[0])>=20?0:1)' 2>/dev/null; then
  echo "[1/7] 已有 node $(node -v)，跳过安装"
else
  echo "[1/7] 装 Node v$NODE_V ..."
  ARCH=$(uname -m); case "$ARCH" in x86_64) NARCH=x64;; aarch64) NARCH=arm64;; *) echo "不认识的架构 $ARCH"; exit 1;; esac
  TARBALL="node-v$NODE_V-linux-$NARCH.tar.gz"
  if ! curl -fsSL -o /tmp/$TARBALL "https://mirrors.aliyun.com/nodejs-release/v$NODE_V/$TARBALL"; then
    echo "    阿里云镜像没拿到，换官方源..."
    curl -fsSL -o /tmp/$TARBALL "https://nodejs.org/dist/v$NODE_V/$TARBALL"
  fi
  mkdir -p /usr/local/lib/node-$NODE_V
  tar -xzf /tmp/$TARBALL -C /usr/local/lib/node-$NODE_V --strip-components=1
  ln -sf /usr/local/lib/node-$NODE_V/bin/node /usr/local/bin/node
  ln -sf /usr/local/lib/node-$NODE_V/bin/npm /usr/local/bin/npm
  ln -sf /usr/local/lib/node-$NODE_V/bin/npx /usr/local/bin/npx
  echo "    node $(node -v) 就位"
fi

# ── 2. 云端出片三件套：无头浏览器（画画面）+ 剪辑工具（压片合声）+ Python 念稿库（配音） ──
#   这三样缺任何一样，云端就出不了片（网站照常跑），所以逐项体检逐项报，不硬拦装机。
echo "[2/7] 云端出片三件套..."
PKGS=""
if command -v apt-get >/dev/null 2>&1; then PM=apt-get; elif command -v dnf >/dev/null 2>&1; then PM=dnf; elif command -v yum >/dev/null 2>&1; then PM=yum; elif command -v apk >/dev/null 2>&1; then PM=apk; else PM=""; fi
[ -n "$PM" ] && export DEBIAN_FRONTEND=noninteractive

have() { command -v "$1" >/dev/null 2>&1; }
# 缺哪样才装哪样（升级重装不重复拉大包）
[ -n "$PM" ] && {
  case "$PM" in
    apt-get) A=""; have chromium || have chromium-browser || have google-chrome || A="$A chromium"; have ffmpeg || A="$A ffmpeg"; have python3 || A="$A python3"; have pip3 || A="$A python3-pip"; fc-list 2>/dev/null | grep -qi 'noto.*cjk' || A="$A fonts-noto-cjk"; [ -n "$A" ] && { apt-get update -y >/dev/null 2>&1 || true; apt-get install -y $A || echo "    ✗ 有包装不上（$A），继续"; } ;;
    dnf|yum) A=""; have chromium || A="$A chromium"; have ffmpeg || A="$A ffmpeg"; have python3 || A="$A python3"; have pip3 || A="$A python3-pip"; fc-list 2>/dev/null | grep -qi 'noto.*cjk' || A="$A google-noto-sans-cjk-ttc-fonts"; [ -n "$A" ] && { $PM install -y $A || echo "    ✗ 有包装不上（$A）——CentOS 系 ffmpeg 常要 EPEL/RPM Fusion，继续装机，最后体检会报"; } ;;
    apk)     A=""; have chromium || A="$A chromium"; have ffmpeg || A="$A ffmpeg"; have python3 || A="$A python3"; have pip3 || A="$A py3-pip"; [ -n "$A" ] && { apk add --no-cache $A || echo "    ✗ 有包装不上（$A），继续"; } ;;
  esac
}
# ffmpeg 走包管理器装不上时的兜底：拉一份自带依赖的静态版（只放 /usr/local/bin，不动系统）
if ! have ffmpeg; then
  echo "    包管理器没给 ffmpeg，试拉静态版..."
  ARCH=$(uname -m)
  if [ "$ARCH" = "x86_64" ] && curl -fsSL -o /tmp/ff.tar.xz https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz; then
    mkdir -p /opt/ffmpeg-static && tar -xJf /tmp/ff.tar.xz -C /opt/ffmpeg-static --strip-components=1
    ln -sf /opt/ffmpeg-static/ffmpeg /usr/local/bin/ffmpeg && ln -sf /opt/ffmpeg-static/ffprobe /usr/local/bin/ffprobe
    echo "    ✓ 静态版 ffmpeg 就位"
  else
    echo "    ✗ ffmpeg 没装上：云端出片用不了（网页其余功能不受影响）"
  fi
fi
# 念稿库（pip 走阿里云镜像；装过但版本太老也顶上去）
if have python3; then
  pip3 install -q -i https://mirrors.aliyun.com/pypi/simple/ "edge-tts>=$TTS_V" 2>/dev/null \
    || python3 -m pip install -q -i https://mirrors.aliyun.com/pypi/simple/ "edge-tts>=$TTS_V" 2>/dev/null \
    || echo "    ✗ 念稿库没装上：手动跑 pip3 install -i https://mirrors.aliyun.com/pypi/simple/ \"edge-tts>=$TTS_V\""
else
  echo "    ✗ 没有 python3：云端出不了配音"
fi
echo "    现在：浏览器=$(command -v chromium || command -v chromium-browser || command -v google-chrome || echo 缺) · 剪辑工具=$(command -v ffmpeg || echo 缺) · python=$(command -v python3 || echo 缺) · 念稿库=$(python3 -c 'import edge_tts;print(edge_tts.__version__)' 2>/dev/null || echo 缺)"

# ── 3. 解包（升级模式保住旧账本） ──
echo "[3/7] 解包到 $APP ..."
if [ -f "$APP/server/data/store.json" ]; then
  cp -f "$APP/server/data/store.json" /tmp/store-keep.json
fi
mkdir -p /opt
tar -xzf "$PKG" -C /opt
if [ -f /tmp/store-keep.json ]; then
  mv -f /tmp/store-keep.json "$APP/server/data/store.json"
  echo "    （升级模式：原账本已保留）"
fi
chmod 600 "$APP/server/.env" 2>/dev/null || true
# 云端出片的旋钮写进 .env（只在没写过时追加；注释形式，要改数去掉 # 就行）
if [ -f "$APP/server/.env" ] && ! grep -q '^# \[ film\]' "$APP/server/.env"; then
  cat >> "$APP/server/.env" <<'ENVEOF'

# [ film ] 云端出片旋钮（不改动就用括号里的默认；改完 systemctl restart xhs-demo 生效）
# FILM_DAILY=10          # 每人每天最多几条（默认 10）
# FILM_CONC=1            # 同时出几条（默认 1；机器核多内存大才往上开）
# FILM_MAX_SCENES=60     # 一条最多几幕（默认 60）
# FILM_MAX_SECS=180      # 一条成片最长几秒（默认 180）
# FILM_KEEP_DAYS=7       # 片子留几天（默认 7，过期自动清）
# FILM_BROWSER=/usr/bin/chromium    # 无头浏览器路径（指不到时才填）
# FILM_FFMPEG=/usr/local/bin/ffmpeg # 剪辑工具路径（指不到时才填）
# FILM_FFPROBE=/usr/local/bin/ffprobe
# FILM_PYTHON=python3                 # 念稿库用的 python（默认 python3）
ENVEOF
  echo "    （.env 已追加云端出片旋钮注释块，默认值生效）"
fi

# ── 4. systemd 常驻 ──
echo "[4/7] 配 systemd 常驻（开机自启 + 掉线自拉）..."
cat > /etc/systemd/system/xhs-demo.service <<EOF
[Unit]
Description=XHS demo server
After=network.target

[Service]
Type=simple
WorkingDirectory=$APP
ExecStart=/usr/local/bin/node server/dev-server.mjs
Restart=always
RestartSec=3
Environment=PORT=$PORT_V

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable xhs-demo >/dev/null 2>&1 || true
systemctl restart xhs-demo

# ── 5. 本机自测 ──
echo "[5/7] 等它起来..."
OK=0
for i in 1 2 3 4 5 6; do
  if curl -fsS -o /dev/null "http://127.0.0.1:$PORT_V/" 2>/dev/null; then OK=1; break; fi
  sleep 1
done
if [ "$OK" = "1" ]; then echo "    ✓ 本机 127.0.0.1:$PORT_V 已应答"; else echo "    ✗ 服务没起来：journalctl -u xhs-demo -n 50"; exit 1; fi

# ── 6. 系统防火墙（云控制台的安全组/防火墙另开，脚本管不了那层） ──
if systemctl is-active firewalld >/dev/null 2>&1; then
  firewall-cmd --permanent --add-port=$PORT_V/tcp >/dev/null 2>&1 && firewall-cmd --reload >/dev/null 2>&1 \
    && echo "[6/7] firewalld 已放行 $PORT_V" || echo "[6/7] firewalld 放行没成功，留意"
elif command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow $PORT_V/tcp >/dev/null 2>&1 && echo "[6/7] ufw 已放行 $PORT_V" || echo "[6/7] ufw 放行没成功，留意"
else
  echo "[6/7] 系统防火墙没在拦（或没装），跳过"
fi

# ── 7. 收尾：云端出片体检 + 地址 ──
echo "[7/7] 云端出片体检..."
# 体检口要管理员口令（.env 里配了 DEMO_ADMIN_PASS 就得带上；没配只认本机，这里就是本机）
APASS=$(sed -n 's/^DEMO_ADMIN_PASS=//p' "$APP/server/.env" 2>/dev/null | head -1 | tr -d '\r"')
if [ -n "$APASS" ]; then
  PROBE=$(printf '{}' | curl -fsS -X POST -H "x-admin-pass: $APASS" -H 'Content-Type: application/json' --data-binary @- "http://127.0.0.1:$PORT_V/api/film/probe" 2>/dev/null || echo '')
else
  PROBE=$(curl -fsS -X POST -d '{}' "http://127.0.0.1:$PORT_V/api/film/probe" 2>/dev/null || echo '')
fi
if [ -z "$PROBE" ]; then
  echo "    ✗ 体检没回话（服务可能刚起还没就绪）：过一会手动跑  curl -X POST http://127.0.0.1:$PORT_V/api/film/probe"
else
  printf '%s' "$PROBE" | node "$APP/server/film/probe-log.mjs"
fi
IP=$(curl -fsS --max-time 3 http://100.100.100.200/latest/meta-data/eipv4 2>/dev/null || echo "<公网IP>")
if [ "$PORT_V" = "80" ]; then URLSHOW="http://$IP/"; else URLSHOW="http://$IP:$PORT_V/"; fi
echo "  访问：$URLSHOW     ★ 云控制台的安全组/防火墙还需放行 TCP $PORT_V"
echo "  日志：journalctl -u xhs-demo -f      重启：systemctl restart xhs-demo"
