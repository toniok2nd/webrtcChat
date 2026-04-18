import os
from flask import Flask, render_template, request
from flask_socketio import SocketIO, join_room, leave_room, emit

app = Flask(__name__)
app.config["SECRET_KEY"] = os.urandom(24)
# Enable CORS for any origin (development). In prod set explicit origins.
socketio = SocketIO(app, cors_allowed_origins="*")

@app.route("/")
def index():
    return render_template("index.html")

@socketio.on("join")
def on_join(data):
    room = data["room"]
    join_room(room)
    # Notify everybody (including the newcomer) that a user joined.
    emit("joined", {"sid": request.sid, "room": room}, room=room)

    # If after joining the room now has exactly two participants, tell the
    # *new* participant that the room is ready for the WebRTC handshake.
    # Flask‑SocketIO stores rooms in ``socketio.server.rooms`` which maps a
    # room name to a set of session IDs.
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
    socketio.run(app, host="0.0.0.0", port=5000, debug=True)
