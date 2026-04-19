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
# Help text
# --------------------------------------------------------------
_show_help() {
    cat <<EOF
Usage: $0 [start|stop|status|show-pass|--help] [options]

Commands:
  start        Start Flask + socat (default command)
  stop         Stop the running Flask and socat processes
  status       Show which Flask/socat processes are running
  show-pass    Show the stored password (if any)
  --help, -h  Show this help message

Options (only for the "start" command):
  --stun <url>        STUN server URL (default: stun:stun.l.google.com:19302)
  --turn <url>        TURN server URL (default: turn:openrelay.metered.ca:80)
  --turn-user <user>  TURN username (default: openrelayproject)
  --turn-pass <pass>  TURN password (default: openrelayproject)
  --password <pw>     Password for the Flask login page.
                       If omitted, a random password will be generated and saved.
EOF
}

# --------------------------------------------------------------
# Sub‑command handling (start / stop / status / show-pass / help)
# --------------------------------------------------------------
# Detect help request early
if [[ "$1" == "--help" || "$1" == "-h" ]]; then
    _show_help
    exit 0
fi

COMMAND="start"
APP_ARGS=()
PASSWORD_ARG=""

while [[ "$#" -gt 0 ]]; do
    case "$1" in
        start|stop|status|show-pass)
            COMMAND="$1"
            shift
            ;;
        --password)
            # Capture the next argument as the password value
            if [[ -n "$2" && "$2" != --* ]]; then
                PASSWORD_ARG="--password $2"
                shift 2
            else
                _die "--password requires a value"
            fi
            ;;
        --*)
            # Anything that looks like an app.py argument is collected
            APP_ARGS+=("$1")
            shift
            ;;
        *)
            # Positional arguments after the command are also passed through
            APP_ARGS+=("$1")
            shift
            ;;
    esac
done

case "$COMMAND" in
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
    show-pass)
        if [[ -f ".secret_pass" ]]; then
            echo -e "🔐  Current password for the Flask app: \e[31m$(cat .secret_pass)\e[0m"
        else
            echo "⚠️  No password file found. The server may not have been started yet."
        fi
        exit 0
        ;;
    start|"")
        # continue with start routine
        ;;
    *)
        _die "Usage: $0 [start|stop|status|show-pass|--help] [options]"
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
# 2️⃣  Launch Flask app in background, forwarding any extra args
# --------------------------------------------------------------
# If you use a virtual environment, activate it here:
#   source venv/bin/activate
# (Uncomment the line above if you have a venv.)

echo "🚀  Starting Flask app (http://${FLASK_HOST}:${FLASK_PORT}) …"
# Append any password argument to the APP_ARGS so app.py receives it
if [[ -n "$PASSWORD_ARG" ]]; then
    APP_ARGS+=("$PASSWORD_ARG")
fi
# Build the command line for app.py, injecting any extra args the user supplied.
nohup python -u app.py "${APP_ARGS[@]}" > flask.log 2>&1 &
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
# 4️⃣  Show the password (if we have it) – in its own red line
# --------------------------------------------------------------
if [[ -f ".secret_pass" ]]; then
    echo -e "\n🔐  Password for the Flask app (generated or supplied):\n\e[31m$(cat .secret_pass)\e[0m"
fi

# --------------------------------------------------------------
# 5️⃣  Brief user info
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

* To view the current password (if any):
      $0 show-pass

* Logs:
      - Flask  → ./flask.log
      - socat  → ./socat.log

* You can also pass any arguments accepted by `app.py` after the command.
  Example:
      $0 start --stun stun:my.stun:3478 --turn turn:my.turn:3478 \
          --turn-user myuser --turn-pass mypass

=====================================================================
EOF

exit 0
