#!/usr/bin/env bash
# --------------------------------------------------------------
#  https_simulator.sh  –  Set‑up an HTTPS front‑end for the Flask‑WebRTC app
# --------------------------------------------------------------
# What it does (in order):
#   1️⃣  Creates a self‑signed certificate (if it does not already exist)
#   2️⃣  Starts the Flask development server (app.py) on 127.0.0.1:5000
#   3️⃣  Starts a socat TLS terminator that listens on 8443 and forwards
#       the decrypted traffic to the Flask server.
# After the script finishes you can open:
#        https://localhost:8443
# (or replace "localhost" with the LAN IP of this machine).
# The script leaves the Flask and socat processes running in the
# background.  Use `./https_simulator.sh stop` to kill them, or simply
# `kill <pid>` if you prefer.
# --------------------------------------------------------------

# -------------------------
# Configuration (edit if you need)
# -------------------------
CERT_DIR="./certs"        # where the cert & key will be stored
CERT_FILE="${CERT_DIR}/cert.pem"
KEY_FILE="${CERT_DIR}/key.pem"

FLASK_HOST="127.0.0.1"
FLASK_PORT=5000

HTTPS_PORT=8443           # port socat will listen on (HTTPS)
BIND_ADDR="0.0.0.0"      # use 0.0.0.0 if you want LAN devices to reach it

# -------------------------
# Helper functions
# -------------------------
_die() {
    echo "❌  $*" >&2
    exit 1
}

# --------------------------------------------------------------
# Sub‑command handling (start / stop / status)
# --------------------------------------------------------------
case "$1" in
    stop)
        echo "Stopping Flask and socat processes..."
        pkill -f "python .*app\.py"
        pkill -f "socat .*OPENSSL-LISTEN:${HTTPS_PORT}"
        echo "✅  Stopped."
        exit 0
        ;;
    status)
        echo "=== Flask processes ==="
        pgrep -a -f "python .*app\.py" || echo "none"
        echo "=== socat processes ==="
        pgrep -a -f "socat .*OPENSSL-LISTEN:${HTTPS_PORT}" || echo "none"
        exit 0
        ;;
    ""|start)
        # continue with start routine
        ;;
    *)
        _die "Usage: $0 [start|stop|status]"
        ;;
esac

# --------------------------------------------------------------
# 1️⃣  Create self‑signed certificate (only if missing)
# --------------------------------------------------------------
if [[ ! -f "${CERT_FILE}" || ! -f "${KEY_FILE}" ]]; then
    echo "🔐  Generating self‑signed certificate..."
    mkdir -p "${CERT_DIR}" || _die "Cannot create ${CERT_DIR}"
    openssl req -newkey rsa:2048 -nodes \
        -keyout "${KEY_FILE}" \
        -x509 -days 365 -out "${CERT_FILE}" \
        -subj "/CN=localhost" \
        || _die "OpenSSL failed"
    echo "✅  Certificate and key written to ${CERT_DIR}"
else
    echo "🔐  Certificate already exists – reusing ${CERT_FILE}"
fi

# --------------------------------------------------------------
# 2️⃣  Launch Flask app in background
# --------------------------------------------------------------
# If you use a virtual environment, activate it here:
#   source venv/bin/activate
# (Uncomment the line above if you have a venv.)

echo "🚀  Starting Flask app (http://${FLASK_HOST}:${FLASK_PORT}) …"
nohup python -u app.py > flask.log 2>&1 &
FLASK_PID=$!
echo "✅  Flask PID = $FLASK_PID (logs → flask.log)"

# --------------------------------------------------------------
# 3️⃣  Launch socat TLS terminator in background
# --------------------------------------------------------------
echo "🔗  Starting socat TLS proxy on https://${BIND_ADDR}:${HTTPS_PORT} → http://${FLASK_HOST}:${FLASK_PORT}"
nohup socat \
    OPENSSL-LISTEN:${HTTPS_PORT},reuseaddr,fork,bind=${BIND_ADDR},cert=${CERT_FILE},key=${KEY_FILE},verify=0 \
    TCP:${FLASK_HOST}:${FLASK_PORT} \
    > socat.log 2>&1 &
SOCAT_PID=$!
echo "✅  socat PID = $SOCAT_PID (logs → socat.log)"

# --------------------------------------------------------------
# 4️⃣  Brief user info
# --------------------------------------------------------------
cat <<EOF

=====================================================================
✅  Everything is up and running!
=====================================================================
* Flask (plain HTTP)   : http://${FLASK_HOST}:${FLASK_PORT}
* HTTPS proxy (socat) : https://${BIND_ADDR}:${HTTPS_PORT}
  (self‑signed cert – your browser will warn you the first time)

* To stop the services:
      $0 stop

* To see which processes are still running:
      $0 status

* Logs:
      - Flask  → ./flask.log
      - socat  → ./socat.log

=====================================================================
EOF

exit 0
