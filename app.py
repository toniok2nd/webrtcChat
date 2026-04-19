import os
import argparse
from flask import Flask, render_template, request
from flask_socketio import SocketIO, join_room, leave_room, emit

app = Flask(__name__)
app.config["SECRET_KEY"] = os.urandom(24)
# Enable CORS for any origin (development). In prod set explicit origins.
socketio = SocketIO(app, cors_allowed_origins="*")

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

@socketio.on("join")
def on_join(data):
    room = data["room"]
    join_room(room)
    # Notify everybody (including the newcomer) that a user joined.
    emit("joined", {"sid": request.sid, "room": room}, room=room)

    # If after joining the room now has exactly two participants, tell the
    # *new* participant that the room is ready for the WebRTC handshake.
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
    # Broadcast to everyone **except** the sender.
    emit("signal", payload, room=room, include_self=False)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Flask‑WebRTC signalling server with configurable STUN/TURN servers")
    parser.add_argument("--stun", default="stun:stun.l.google.com:19302",
                        help="STUN server URL (default: stun:stun.l.google.com:19302)")
    parser.add_argument("--turn", default="turn:openrelay.metered.ca:80",
                        help="TURN server URL (default: turn:openrelay.metered.ca:80)")
    parser.add_argument("--turn-user", default="openrelayproject",
                        help="TURN username (default: openrelayproject)")
    parser.add_argument("--turn-pass", default="openrelayproject",
                        help="TURN password (default: openrelayproject)")
    args = parser.parse_args()

    # Store the values in Flask config so `index()` can inject them into the template.
    app.config["STUN_URL"] = args.stun
    app.config["TURN_URL"] = args.turn
    app.config["TURN_USER"] = args.turn_user
    app.config["TURN_PASS"] = args.turn_pass

    socketio.run(app, host="0.0.0.0", port=5000, debug=True)
