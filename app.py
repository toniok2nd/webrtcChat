import os
import argparse
import secrets
from flask import Flask, render_template, request, redirect, url_for, session, flash
from flask_socketio import SocketIO, join_room, leave_room, emit

app = Flask(__name__)
# Secret key for session signing – can be overridden by env var.
app.config["SECRET_KEY"] = os.getenv("FLASK_SECRET", os.urandom(24))

# Password handling – can be set via env var APP_PASSWORD, CLI --password, or generated randomly.
DEFAULT_PASSWORD = None  # will be filled later if needed

# Enable CORS for any origin (development). In prod set explicit origins.
socketio = SocketIO(app, cors_allowed_origins="*")

# -------------------------------------------------------------------
# Authentication helpers
# -------------------------------------------------------------------
def is_logged_in():
    return session.get("logged_in")

@app.before_request
def require_login():
    # Allow static files, login page, and logout without authentication.
    if request.endpoint in ("login", "static", "logout", None):
        return
    if not is_logged_in():
        return redirect(url_for("login"))

@app.route("/login", methods=["GET", "POST"])  # noqa: E302
def login():
    error = None
    if request.method == "POST":
        pw = request.form.get("password", "")
        if pw == app.config["APP_PASSWORD"]:
            session["logged_in"] = True
            return redirect(url_for("index"))
        else:
            error = "Invalid password"
    return render_template("login.html", error=error)

@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))

# -------------------------------------------------------------------
# Main page (protected)
# -------------------------------------------------------------------
@app.route("/")
def index():
    # Pull ICE server configuration from Flask config (set via CLI args)
    ice_config = {
        "stun": app.config.get("STUN_URL", "stun:stun.l.google.com:19302"),
        "turn": app.config.get("TURN_URL", "turn:openrelay.metered.ca:80"),
        "turn_user": app.config.get("TURN_USER", "openrelayproject"),
        "turn_pass": app.config.get("TURN_PASS", "openrelayproject"),
    }
    return render_template("index.html", **ice_config)

# -------------------------------------------------------------------
# Socket.io signalling
# -------------------------------------------------------------------
@socketio.on("join")
def on_join(data):
    room = data["room"]
    join_room(room)
    emit("joined", {"sid": request.sid, "room": room}, room=room)
    if len(socketio.server.rooms[room]) == 2:
        emit("ready", {"room": room}, room=request.sid)

@socketio.on("leave")
def on_leave(data):
    room = data["room"]
    leave_room(room)
    emit("left", {"sid": request.sid}, room=room)

@socketio.on("signal")
def on_signal(data):
    room = data["room"]
    payload = {
        "sender": request.sid,
        "type": data["type"],
        "payload": data["payload"],
    }
    emit("signal", payload, room=room, include_self=False)

# -------------------------------------------------------------------
# CLI entry point – adds optional password handling.
# -------------------------------------------------------------------
if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Flask‑WebRTC signalling server with configurable STUN/TURN servers and optional password protection"
    )
    parser.add_argument("--stun", default="stun:stun.l.google.com:19302",
                        help="STUN server URL (default: stun:stun.l.google.com:19302)")
    parser.add_argument("--turn", default="turn:openrelay.metered.ca:80",
                        help="TURN server URL (default: turn:openrelay.metered.ca:80)")
    parser.add_argument("--turn-user", default="openrelayproject",
                        help="TURN username (default: openrelayproject)")
    parser.add_argument("--turn-pass", default="openrelayproject",
                        help="TURN password (default: openrelayproject)")
    parser.add_argument("--password", default=None,
                        help="Login password. If omitted, a random one is generated (displayed on startup). Can also be set via APP_PASSWORD env var.")
    args = parser.parse_args()

    # Store ICE configuration in Flask config
    app.config["STUN_URL"] = args.stun
    app.config["TURN_URL"] = args.turn
    app.config["TURN_USER"] = args.turn_user
    app.config["TURN_PASS"] = args.turn_pass

    # Resolve password: CLI > env var > random
    pw_from_env = os.getenv("APP_PASSWORD")
    if args.password:
        final_pw = args.password
    elif pw_from_env:
        final_pw = pw_from_env
    else:
        final_pw = secrets.token_urlsafe(12)
        print("🔐 No password supplied – generated random password:")
        print(final_pw)
    # Store it in Flask config for the login view
    app.config["APP_PASSWORD"] = final_pw
    # Also persist it so https_simulator.sh can show it later
    try:
        with open('.secret_pass', 'w') as f:
            f.write(final_pw)
    except Exception as e:
        print(f"⚠️ Could not write password file: {e}")

    socketio.run(app, host="0.0.0.0", port=5000, debug=True)
