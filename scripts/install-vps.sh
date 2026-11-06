#!/usr/bin/env bash
set -euo pipefail

# Bigman Bot — 1-Command VPS Setup (Ubuntu 22.04 / 24.04 & Debian 12)
# Usage:
#   bash scripts/install-vps.sh [--domain bot.tenmien.com]

DOMAIN="${OMB_DOMAIN:-}"
PORT="${OMB_PORT:-8799}"
APP_DIR="${OMB_APP_DIR:-/opt/bigmanbot}"
DATA_DIR="${OMB_DATA_DIR:-/root/.openmausbot}"

while [ $# -gt 0 ]; do
  case "$1" in
    --domain)
      DOMAIN="${2:-}"
      shift 2
      ;;
    --port)
      PORT="${2:-8799}"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

echo "============================================================"
echo "🚀 BẮT ĐẦU CÀI ĐẶT BIGMAN BOT TRÊN VPS (CHUẨN GROK BOT)"
echo "============================================================"

# 1. Tạo Swap 4GB nếu VPS chưa có Swap (giúp chạy nhiều tab Chrome không tràn RAM)
if ! swapon --show | grep -q '/'; then
  echo "--> [1/7] Tạo 4GB Swap RAM ảo..."
  fallocate -l 4G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=4096
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
else
  echo "--> [1/7] Swap đã có sẵn, bỏ qua."
fi

# 2. Cài đặt thư viện hệ thống & thư viện đồ họa cho Chrome v2 (30 FPS)
echo "--> [2/7] Cài đặt các gói hệ thống & thư viện Chrome..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends \
  ca-certificates curl gnupg git unzip python3 poppler-utils bubblewrap socat \
  libxcb-shm0 libx11-xcb1 libx11-6 libxcb1 libxext6 libxrandr2 \
  libxcomposite1 libxcursor1 libxdamage1 libxfixes3 libxi6 libgtk-3-0 \
  libpangocairo-1.0-0 libpango-1.0-0 libatk1.0-0 libcairo-gobject2 \
  libcairo2 libgdk-pixbuf-2.0-0 libxrender1 libfreetype6 \
  libfontconfig1 libdbus-1-3 libnss3 libnss3-tools libnspr4 \
  libatk-bridge2.0-0 libdrm2 libxkbcommon0 libatspi2.0-0 libcups2 \
  libxshmfence1 libgbm1 fonts-noto-color-emoji fonts-noto-cjk fonts-freefont-ttf
apt-get install -y --no-install-recommends libasound2t64 || apt-get install -y --no-install-recommends libasound2 || true

# 3. Cài đặt Node.js 24 LTS & pnpm
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d. -f1 | tr -d 'v')" -lt 24 ]; then
  echo "--> [3/7] Cài đặt Node.js 24 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
else
  echo "--> [3/7] Node.js $(node -v) đã được cài đặt."
fi
npm install -g pnpm@10.33.0

# 4. Cài đặt các Engine AI (Grok CLI 4.7, Claude Code, OpenAI Codex)
echo "--> [4/7] Cài đặt các bộ não AI (Grok CLI, Claude Code, Codex)..."
if ! command -v grok >/dev/null 2>&1; then
  mkdir -p /tmp/grok-install
  if curl -fsSL https://x.ai/cli/install.sh -o /tmp/grok-install/install.sh; then
    HOME=/tmp/grok-install PATH="/tmp/grok-install/.grok/bin:$PATH" bash /tmp/grok-install/install.sh "1.0.41" || true
    if [ -e /tmp/grok-install/.grok/bin/grok ]; then
      install -m 0755 "$(readlink -f /tmp/grok-install/.grok/bin/grok)" /usr/local/bin/grok
    fi
  fi
  rm -rf /tmp/grok-install
fi
npm install -g @anthropic-ai/claude-code @openai/codex || true

# 5. Build mã nguồn Bigman Bot & cài đặt trình duyệt Chrome v2
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ -f "$SCRIPT_DIR/package.json" ]; then
  APP_DIR="$SCRIPT_DIR"
fi
cd "$APP_DIR"
echo "--> [5/7] Đóng gói giao diện & máy chủ Bigman Bot tại $APP_DIR..."
export ELECTRON_SKIP_BINARY_DOWNLOAD=1
pnpm install --frozen-lockfile || pnpm install
node scripts/prepare-duckdb.mjs || true
pnpm build
pnpm build:server

echo "--> [6/7] Cài đặt trình duyệt Chrome for Testing (Engine Chrome v2 30 FPS)..."
node dist-server/openmausbot.js browser install --with-deps || node dist-server/openmausbot.js browser install || true

# Khởi tạo cấu hình mặc định chuẩn Grok Bot (Tiếng Việt + Chrome v2 + Chia sẻ máy tính)
mkdir -p "$DATA_DIR"
CONFIG_FILE="$DATA_DIR/config.json"
if [ ! -f "$CONFIG_FILE" ]; then
  cat >"$CONFIG_FILE" <<'EOF'
{
  "language": "vi",
  "browserEngine": {
    "engine": "chrome"
  },
  "features": {
    "browser": true,
    "sharedComputers": true
  }
}
EOF
  chmod 600 "$CONFIG_FILE"
fi

# 7. Tự động xác định tên miền HTTPS (hoặc dùng sslip.io theo IP của VPS) & cài systemd chạy 24/7
PUBLIC_IP="$(curl -4 -fsSL https://ifconfig.me 2>/dev/null || curl -4 -fsSL https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"
if [ -z "$DOMAIN" ] && [ -n "$PUBLIC_IP" ]; then
  DOMAIN="${PUBLIC_IP//./-}.sslip.io"
fi

echo "--> [7/7] Đăng ký dịch vụ chạy ngầm 24/7 (systemd) với HTTPS ($DOMAIN)..."
if command -v ufw >/dev/null 2>&1; then
  ufw allow 80/tcp >/dev/null 2>&1 || true
  ufw allow 443/tcp >/dev/null 2>&1 || true
fi

if [ -n "$DOMAIN" ]; then
  node dist-server/openmausbot.js service install --port "$PORT" --data-dir "$DATA_DIR" --domain "$DOMAIN" --label "Bigman Cloud VPS"
else
  node dist-server/openmausbot.js service install --port "$PORT" --data-dir "$DATA_DIR" --label "Bigman Cloud VPS"
fi
if [ -f /etc/systemd/system/openmausbot.service ]; then
  sed -i '/CapabilityBoundingSet=/d' /etc/systemd/system/openmausbot.service
  grep -q 'OMB_BROWSER_SANDBOX=0' /etc/systemd/system/openmausbot.service || sed -i '/Environment=OMB_DATA_DIR=/a Environment=OMB_BROWSER_SANDBOX=0' /etc/systemd/system/openmausbot.service
  systemctl daemon-reload
  systemctl restart openmausbot
fi

echo "Đang chờ máy chủ Bigman Bot khởi động..."
for _ in $(seq 1 40); do
  if curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo ""
echo "============================================================"
echo "✅ HOÀN TẤT CÀI ĐẶT BIGMAN BOT TRÊN VPS!"
echo "============================================================"
if [ -n "$DOMAIN" ]; then
  node dist-server/openmausbot.js pair --port "$PORT" --data-dir "$DATA_DIR" --public-url "https://$DOMAIN" --label "Admin" || true
  echo ""
  echo "🌐 Địa chỉ truy cập HTTPS (Máy tính & Điện thoại): https://$DOMAIN"
else
  node dist-server/openmausbot.js pair --port "$PORT" --data-dir "$DATA_DIR" --label "Admin" || true
fi
echo "============================================================"
