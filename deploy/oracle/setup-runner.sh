#!/usr/bin/env bash
# Set up an Oracle Cloud Always Free Ubuntu server (Mumbai or Hyderabad) as MyAvedan's notice reader.
#
#   RUNNER_TOKEN=<token from GitHub> bash setup-runner.sh
#
# Get the token: GitHub → akhil6174/myavedan → Settings → Actions → Runners → New self-hosted runner
# → Linux → copy the value after --token (valid for about an hour).
#
# What it does: installs Python and Tesseract OCR (English + Hindi), adds swap on small machines,
# sets India time, turns on automatic security updates, installs the GitHub runner as a service with
# the label "india", and prepares the reader's Python environment. Safe to run again.
set -euo pipefail

REPO_URL="https://github.com/akhil6174/myavedan"
RUNNER_NAME="${RUNNER_NAME:-oracle-india}"
RUNNER_DIR="$HOME/actions-runner"
STATE_DIR="$HOME/.myavedan"

if [ -z "${RUNNER_TOKEN:-}" ]; then
  echo "RUNNER_TOKEN is missing. Run it as:  RUNNER_TOKEN=xxxxx bash setup-runner.sh" >&2
  exit 1
fi

echo "==> System packages"
sudo apt-get update -y
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y \
  python3 python3-venv python3-pip tesseract-ocr tesseract-ocr-eng tesseract-ocr-hin \
  curl jq tar unattended-upgrades
sudo timedatectl set-timezone Asia/Kolkata
sudo dpkg-reconfigure -f noninteractive unattended-upgrades

echo "==> Swap (helps the 1 GB free machines read large PDFs)"
if [ "$(free -m | awk '/^Mem:/{print $2}')" -lt 4000 ] && ! swapon --show | grep -q /swapfile; then
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

echo "==> Reader's Python environment"
mkdir -p "$STATE_DIR"
python3 -m venv "$STATE_DIR/venv"
"$STATE_DIR/venv/bin/pip" install --quiet --upgrade pip
"$STATE_DIR/venv/bin/pip" install --quiet "pymupdf>=1.24" "pytesseract>=0.3.10" "pillow>=10.0"
tesseract --list-langs | grep -q hin && echo "Tesseract has Hindi."

echo "==> GitHub runner"
case "$(uname -m)" in
  aarch64|arm64) ARCH=arm64 ;;
  x86_64|amd64) ARCH=x64 ;;
  *) echo "Unsupported CPU $(uname -m)" >&2; exit 1 ;;
esac
VERSION="$(curl -fsSL https://api.github.com/repos/actions/runner/releases/latest | jq -r .tag_name | sed 's/^v//')"
mkdir -p "$RUNNER_DIR" && cd "$RUNNER_DIR"
if [ ! -f ./config.sh ]; then
  curl -fsSL -o runner.tar.gz "https://github.com/actions/runner/releases/download/v${VERSION}/actions-runner-linux-${ARCH}-${VERSION}.tar.gz"
  tar xzf runner.tar.gz && rm runner.tar.gz
fi
if [ -f ./.runner ]; then
  echo "Runner already configured; reinstalling the service."
  sudo ./svc.sh stop || true
  sudo ./svc.sh uninstall || true
  ./config.sh remove --token "$RUNNER_TOKEN" || true
fi
./config.sh --unattended --url "$REPO_URL" --token "$RUNNER_TOKEN" \
  --name "$RUNNER_NAME" --labels india,linux,oracle --work _work --replace
sudo ./svc.sh install "$USER"
sudo ./svc.sh start

echo
echo "Done. GitHub → Settings → Actions → Runners should show '$RUNNER_NAME' as Idle."
echo "The reader will run at 11:00 and 19:00 IST. Its memory is in $STATE_DIR."
