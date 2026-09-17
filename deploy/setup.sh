#!/usr/bin/env bash
#
# One-shot setup for CS++ Flappy on a fresh Ubuntu/Debian VPS.
#
#   curl -fsSL https://raw.githubusercontent.com/<you>/<repo>/main/deploy/setup.sh | sudo bash
#
# or, after cloning:
#
#   sudo bash deploy/setup.sh
#
# Idempotent: safe to re-run. Never touches the database.

set -euo pipefail

APP_USER="cspp"
APP_DIR="/srv/cspp-flappy"
DATA_DIR="/var/lib/cspp-flappy"
SERVICE="cspp-flappy"
NODE_MAJOR="22"

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!!  %s\033[0m\n' "$*"; }

if [[ $EUID -ne 0 ]]; then
  echo "Run with sudo." >&2
  exit 1
fi

# --- Node ------------------------------------------------------------
# better-sqlite3 is a native module. Node 22 LTS has prebuilt binaries, so
# no compiler is needed; without a prebuild it would try to build from
# source and fail on a bare VPS.
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | cut -c2- | cut -d. -f1)" -lt 20 ]]; then
  log "Installing Node.js ${NODE_MAJOR}.x"
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg
  mkdir -p /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update -qq
  apt-get install -y -qq nodejs
else
  log "Node $(node -v) already installed"
fi

# --- Service user ----------------------------------------------------
if ! id "$APP_USER" >/dev/null 2>&1; then
  log "Creating service user: $APP_USER"
  adduser --system --group --home "$APP_DIR" --no-create-home "$APP_USER"
else
  log "Service user $APP_USER already exists"
fi

# --- Directories -----------------------------------------------------
log "Preparing directories"
mkdir -p "$APP_DIR" "$DATA_DIR"

# The database lives OUTSIDE the app directory, so redeploying the code
# can never delete the scores.
chown -R "$APP_USER:$APP_USER" "$DATA_DIR"
chmod 750 "$DATA_DIR"

# --- Application code ------------------------------------------------
# If this script is run from inside a clone, copy it into place.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

if [[ -f "$REPO_ROOT/server.js" ]]; then
  log "Installing application from $REPO_ROOT"
  # --delete keeps the target clean, but never touch the data directory.
  rsync -a --delete \
    --exclude 'node_modules' \
    --exclude 'db' \
    --exclude '.git' \
    "$REPO_ROOT/" "$APP_DIR/"
else
  warn "No server.js found next to this script."
  warn "Clone the repo into $APP_DIR yourself, then re-run."
fi

chown -R "$APP_USER:$APP_USER" "$APP_DIR"

# --- Dependencies ----------------------------------------------------
log "Installing production dependencies"
cd "$APP_DIR"
sudo -u "$APP_USER" npm ci --omit=dev 2>/dev/null \
  || sudo -u "$APP_USER" npm install --omit=dev

# --- Service ---------------------------------------------------------
log "Installing systemd service"
cp "$APP_DIR/deploy/${SERVICE}.service" "/etc/systemd/system/${SERVICE}.service"
systemctl daemon-reload
systemctl enable "$SERVICE"
systemctl restart "$SERVICE"

sleep 2

# --- Verify ----------------------------------------------------------
log "Checking health"
if curl -fsS --max-time 5 http://127.0.0.1:3000/api/health >/dev/null; then
  echo "    health check OK"
else
  warn "Health check failed. Inspect with:"
  warn "  journalctl -u $SERVICE -n 50 --no-pager"
  exit 1
fi

PUBLIC_IP="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || echo '<your-server-ip>')"

cat <<EOF

  CS++ Flappy is running.

    Game     : http://${PUBLIC_IP}:3000
    Display  : http://${PUBLIC_IP}:3000/display

  Next steps:
    - Open the firewall:   sudo ufw allow 3000/tcp
    - Follow logs:         journalctl -u ${SERVICE} -f
    - Restart:             sudo systemctl restart ${SERVICE}

  Strongly recommended before the event: put a domain and HTTPS in front
  of this (see deploy/README.md). Browsers increasingly warn on plain
  http, and a warning page between a student and the game costs you
  players.

EOF
