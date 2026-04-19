# Flask‑WebRTC Multi‑person Demo (Full‑mesh)

## Table of Contents
- [Overview](#overview)
- [Features](#features)
- [Architecture diagram](#architecture-diagram)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Running the signalling server](#running-the-signalling-server)
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
| **HTTPS helper** | `https_simulator.sh` – a tiny script that creates a self‑signed cert and runs a `socat` TLS terminator so you can serve the app over HTTPS (required for `getUserMedia` on non‑localhost domains) |

The demo now supports **any number of participants** (full‑mesh). Each participant creates a dedicated `RTCPeerConnection` for **every other participant**, and a separate `<video>` element is generated for each remote stream.

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
*All media traffic (audio/video) flows **directly** between browsers once ICE succeeds.
*The STUN server is only used for the *host‑candidate* discovery; media is never relayed through it.

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
The `requirements.txt` contains:
```
Flask==3.0.3
Flask‑SocketIO==5.3.6
eventlet==0.36.1    # async worker for SocketIO
```

## Running the signalling server
```bash
# Activate the virtualenv if not already active
source venv/bin/activate   # Windows: venv\Scripts\activate

# Start the server (debug mode prints lots of info)
python app.py
```
The server will listen on **`0.0.0.0:5000`** (plain HTTP).  Open a browser and go to:
```
http://localhost:5000
```
You should see the UI with a room‑name input.

## Running the tiny STUN server
The repo ships with `mini_stun_server.py`, a minimal STUN Binding‑Response implementation.
```bash
# In another terminal (you can keep it in the same venv)
python mini_stun_server.py [--host 0.0.0.0] [--port 3478]
```
*If you intend to reach the demo from the Internet, forward UDP 3478 from your router to the host running this script.*

## Running the HTTPS simulator (optional)
If you want to serve the demo over **HTTPS** (required on many browsers for `getUserMedia` when you are not on `localhost`), use the provided `https_simulator.sh` script. It will:
1. Generate a self‑signed certificate (if one does not already exist).
2. Start the Flask app on `127.0.0.1:5000` in the background.
3. Launch a `socat` TLS terminator that listens on **port 8443** and forwards decrypted traffic to the Flask server.

### Basic usage
```bash
# Start both Flask and the TLS proxy (the first time it will also create a cert)
./https_simulator.sh start   # `start` is the default, you can omit it
```
You will see output similar to:
```
✅  Certificate and key written to ./certs
🚀  Starting Flask app (http://127.0.0.1:5000) …
✅  Flask PID = 12345 (logs → flask.log)
🔗  Starting socat TLS proxy on https://0.0.0.0:8443 → http://127.0.0.1:5000
✅  socat PID = 12346 (logs → socat.log)
```
Now open **`https://<your‑machine‑IP>:8443`** in a browser. The first visit will show a security warning because the certificate is self‑signed; accept the exception (or import the cert into your trusted store for a smoother experience).

### Sub‑commands
| Command | What it does |
|---------|--------------|
| `./https_simulator.sh start` (or just `./https_simulator.sh`) | Generates cert if missing, launches Flask and `socat` in the background. |
| `./https_simulator.sh stop` | Kills the Flask and `socat` processes started by the script. |
| `./https_simulator.sh status` | Shows the PIDs of the running Flask and `socat` processes, or reports “none”. |

### Customisation
Edit the variables at the top of the script if you need to change:
- `CERT_DIR` – where the cert/key are stored.
- `FLASK_HOST` / `FLASK_PORT` – where the Flask app should listen (defaults to `127.0.0.1:5000`).
- `HTTPS_PORT` – the external TLS port (default `8443`).
- `BIND_ADDR` – use `0.0.0.0` to allow LAN devices to connect via HTTPS.

### Note on browsers
- **Chrome/Edge/Firefox** will allow webcam access on `https://localhost:8443` after you accept the self‑signed warning.
- If you access the demo from another device on the LAN, use the host’s LAN IP (e.g., `https://192.168.1.10:8443`). The same warning appears; accept it.

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
| Browser warns about self‑signed cert when using HTTPS simulator | The cert is self‑signed; you need to accept the exception or import it into the trusted store. |

## License
This repository is released under the **MIT License** – you are free to use, modify, and distribute it.

---
*Enjoy building multi‑person WebRTC rooms! 🎥🚀*