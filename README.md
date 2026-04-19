# Flask‑WebRTC Multi‑person Demo (Full‑mesh)

## Table of Contents
- [Overview](#overview)
- [Features](#features)
- [Architecture diagram](#architecture-diagram)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Running the signalling server directly](#running-the-signalling-server-directly)
- [Running the tiny STUN server](#running-the-tiny-stun-server)
- [Running the HTTPS simulator (optional)](#running-the-https-simulator-optional)
- [Connecting clients (web browsers)](#connecting-clients-web-browsers)
- [Multi‑person (3+ peers) workflow](#multi‑person-3‑peers-workflow)
- [Using TURN (coturn) for reliable connectivity](#using-turn-coturn-for-reliable-connectivity)
- [Troubleshooting](#troubleshooting)
- [License](#license)

---

## Overview
This repository contains a **minimal multi‑person WebRTC video‑chat demo** built with:

| Component | Technology |
|-----------|------------|
| **Signalling server** | Flask + Flask‑SocketIO (Python) |
| **Web UI** | HTML + JavaScript (plain, no framework) |
| **STUN/TURN** | Tiny STUN server (`mini_stun_server.py`) + optional **coturn** relay |
| **HTTPS helper** | `https_simulator.sh` – creates a self‑signed certificate, runs Flask, and starts a `socat` TLS terminator for HTTPS (required for `getUserMedia` on non‑localhost domains) |

The demo now supports **any number of participants** (full‑mesh). Each participant creates a dedicated `RTCPeerConnection` for every other participant, and a separate `<video>` element is generated for each remote stream.

## Features
- **Full‑mesh** WebRTC: every user gets a direct peer‑to‑peer connection to every other user.
- **Dynamic room creation** – just type any name and hit **Join**.
- **Graceful leave** – closing a tab or clicking **Leave** tears down all connections cleanly.
- **Embedded STUN server** (`mini_stun_server.py`).
- **TURN support** – the client ships with a public TURN server; you can replace it with your own `coturn` instance.
- **HTTPS wrapper** – `https_simulator.sh` creates a self‑signed certificate and proxies traffic via `socat`, making the demo work on browsers that require HTTPS for webcam access.
- **Responsive UI** – a `<div id="remoteContainer">` holds a video element for each remote participant.

## Architecture diagram
```
+-------------------+          WebSocket (signalling)            +-------------------+
|   Browser A      |  <-------------------------------------  |   Flask‑SocketIO  |
| (HTML/JS)       |                                          |   (app.py)        |
+-------------------+                                          +-------------------+
        |  ^                                                          |
        |  |  ICE candidates / SDP (via signalling)                   |
        v  |                                                          v
+-------------------+          UDP (STUN)                     +-------------------+
|   Browser B      |  <-------------------------------------  | mini_stun_server |
+-------------------+                                          +-------------------+
```
*All media traffic (audio/video) flows **directly** between browsers once ICE succeeds.*
*The STUN server is only used for *host‑candidate* discovery; media is never relayed through it.*

## Prerequisites
- Python 3.8 or newer
- `pip`
- A modern browser with WebRTC support (Chrome, Edge, Firefox, Safari)
- (Optional) Public IP or port‑forwarded router if you want to test across the Internet.
- `openssl` and `socat` installed if you plan to use the HTTPS simulator (most Linux/macOS distributions ship them; on Windows you can use WSL or install via MSYS2).

## Installation
```bash
# Clone the repository (or copy the files into a folder)
git clone https://github.com/your‑username/your‑repo.git
cd webrtcChat

# Create a virtual environment (recommended)
python3 -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate

# Install Python dependencies
pip install -r requirements.txt
```
`requirements.txt` contains:
```
Flask==3.0.3
Flask‑SocketIO==5.3.6
eventlet==0.36.1    # async worker for SocketIO
```

## Running the signalling server directly
If you just want to start the Flask app **without** HTTPS wrapping, you can run it directly.  The server accepts optional command‑line arguments to customise the STUN/TURN servers (defaults are shown in brackets):
```bash
python app.py \
    --stun stun:stun.l.google.com:19302 \
    --turn turn:openrelay.metered.ca:80 \
    --turn-user openrelayproject \
    --turn-pass openrelayproject
```
The values are injected into the HTML page and become available to the JavaScript via the global `window.ICE_CONFIG` object.

## Running the tiny STUN server
The repo ships with `mini_stun_server.py`, a minimal STUN Binding‑Response implementation.
```bash
# In another terminal (you can keep it in the same venv)
python mini_stun_server.py [--host 0.0.0.0] [--port 3478]
```
*If you intend to reach the demo from the Internet, forward UDP 3478 from your router to the host running this script.*

## Running the HTTPS simulator (optional)
`https_simulator.sh` is a convenience wrapper that:
1. Generates a **self‑signed** certificate (once).
2. Starts the Flask app **in the background**, passing along any arguments you give to the script (so you can configure STUN/TURN on the fly).
3. Starts a **`socat` TLS terminator** listening on **port 8443** (configurable) and forwarding traffic to the Flask server.

### Basic usage
```bash
# Start Flask + HTTPS proxy (the first time it will also create a cert)
./https_simulator.sh start \
    --stun stun:stun.l.google.com:19302 \
    --turn turn:openrelay.metered.ca:80 \
    --turn-user openrelayproject \
    --turn-pass openrelayproject
```
You can omit the `--stun/--turn/...` options – the script will forward **no extra arguments**, and `app.py` will fall back to its built‑in defaults.

### Sub‑commands
| Command | What it does |
|---------|--------------|
| `./https_simulator.sh start` (or just `./https_simulator.sh`) | Generates the cert if missing, launches Flask and `socat` in the background. Any additional arguments after the command are passed verbatim to `app.py`. |
| `./https_simulator.sh stop` | Kills the Flask and `socat` processes started by the script. |
| `./https_simulator.sh status` | Shows the PIDs of the running Flask and `socat` processes, or reports “none”. |
| `./https_simulator.sh show-pass` | Prints the stored password (if any) **in red** on its own line. |
| `./https_simulator.sh --help` or `-h` | Displays a full usage message, including the new `--password` option. |

### Customisation
Edit the variables at the top of the script if you need to change:
- `CERT_DIR` – where the cert/key are stored.
- `FLASK_HOST` / `FLASK_PORT` – where the Flask app should listen (defaults to `127.0.0.1:5000`).
- `HTTPS_PORT` – the external TLS port (default `8443`).
- `BIND_ADDR` – use `0.0.0.0` to allow LAN devices to connect via HTTPS.

After the script finishes, open **`https://<your‑machine‑IP>:8443`** in a browser. Because the certificate is self‑signed, the browser will display a warning; accept the exception (or import the cert into your trusted store for a smoother experience).

### Password handling
- **`--password <pw>`** – Supply a password for the Flask login page.  
  If omitted, a **random URL‑safe password** will be generated, printed, and saved to `.secret_pass`.
- When the server starts, the password is printed **on its own line in red**:
  ```
  🔐  Password for the Flask app (generated or supplied):
  [31myourRandomPass[0m
  ```
- Use `./https_simulator.sh show-pass` later to view the stored password (also red).

## Connecting clients (web browsers)
1. Open the page `http://<SERVER_IP>:5000` **or** `https://<SERVER_IP>:8443` (if you ran the HTTPS simulator) in **two or more** browsers (different computers, phones, or separate tabs).
2. Type the **same room name** in each client and click **Join room**.
3. Grant permission for webcam/mic when prompted.
4. You will see **your own video** plus a **grid of videos** – one for each remote participant. The UI automatically adds a `<video>` element for every new peer and removes it when that peer leaves.
5. Click **Leave room** to close all connections.

## Multi‑person (3+ peers) workflow
1. **First user** creates the room – no offers are sent yet.
2. **Second user** joins – the server broadcasts a `joined` event to *both* users. Each creates a `RTCPeerConnection` for the other and the **newer** participant (the one that just joined) becomes the *caller* and sends an SDP **offer**.
3. **Third (or later) user** joins – the server sends a `joined` event to **all** participants, including the newcomer. Every existing participant creates a new `RTCPeerConnection` for the newcomer and immediately sends an offer. The newcomer receives offers from all existing peers, answers each one, and ends up with one connection per remote peer.
4. **Leaving** – when a participant clicks **Leave** or closes the tab, a `left` event is broadcast, and every remaining client removes the corresponding video element and closes the associated `RTCPeerConnection`.

The code lives in `static/main.js` and uses a **`peers` map** (`sid → { pc, video }`) so that signalling messages (`offer`, `answer`, `ice`) are always routed to the correct connection.

## Using TURN (coturn) for reliable connectivity
When participants are behind **symmetric NATs** or strict corporate firewalls, direct UDP may fail. The demo already includes a public TURN server (`turn:openrelay.metered.ca:80`). For production you’ll want to run **your own** TURN server (e.g., `coturn`).

### Quick coturn setup (Debian/Ubuntu)
```bash
sudo apt-get update
sudo apt-get install coturn
```
Create `/etc/turnserver.conf` (minimal example):
```conf
listening-port=3478
listening-ip=0.0.0.0          # listen on all interfaces
relay-ip=YOUR_PUBLIC_IP        # the IP that clients will use to reach the relay
min-port=50000
max-port=60000
realm=webrtc-demo
user=webrtcuser:webrtcpassword   # simple long‑term credential
no-ssl                         # enable UDP/TCP only (remove for TLS)
log-file=/var/log/turnserver.log
simple-log
```
Start the server:
```bash
sudo turnserver -c /etc/turnserver.conf -v
```
Now replace the TURN entry in `static/main.js`:
```js
{
  urls: "turn:YOUR_PUBLIC_IP:3478",
  username: "webrtcuser",
  credential: "webrtcpassword"
}
```
The client will automatically fall back to the TURN relay if direct peer‑to‑peer candidates fail. You can verify TURN usage by opening the browser console – ICE candidates whose `type` is `relay` indicate that media is being relayed through the TURN server.

## Troubleshooting
| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| No video appears on any side | Camera permission denied / page not served over HTTPS | Use `https://` (or `localhost`), allow camera in browser settings. |
| One side sees only its own video (one‑way) | Missing TURN, blocked UDP, or ICE failed in one direction | Verify that UDP 3478 (STUN) and TURN ports are reachable. Run your own TURN if necessary. |
| `Cannot set remote answer in state stable` | Old code attempted to set an answer before a local offer existed. | Updated `main.js` now checks `signalingState` before applying SDP. |
| `Socket.IO connection error` | Server not reachable, CORS, wrong port | Ensure Flask is running on `0.0.0.0:5000`, firewall allows TCP 5000, and the page uses the correct address. |
| STUN server logs “Invalid STUN packet” | Test client sent a malformed packet (e.g., wrong magic cookie) | Use a proper STUN client (`pystun3`, browser ICE). |
| Browser warns about self‑signed cert when using HTTPS simulator | The cert is self‑signed; you need to accept the exception or import it into the trusted store. | Click “Advanced → Proceed anyway” (Chrome) or add the cert to system trust store. |

## License
This repository is released under the **MIT License** – you are free to use, modify, and distribute it.

---
*Enjoy building multi‑person WebRTC rooms! 🎥🚀*
