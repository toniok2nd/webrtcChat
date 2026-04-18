# Flask‑WebRTC Demo with a Tiny STUN Server

## Table of Contents
- [Overview](#overview)
- [Features](#features)
- [Architecture diagram](#architecture-diagram)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Running the Flask signalling server](#running-the-flask-signalling-server)
- [Running the tiny STUN server](#running-the-tiny-stun-server)
- [Connecting clients (web browsers)](#connecting-clients-web-browsers)
- [Testing the STUN server independently](#testing-the-stun-server-independently)
- [Multi‑person (3+ peers) walkthrough](#multi‑person-3‑peers-walkthrough)
- [Scaling beyond a mesh – brief notes on SFU/TURN](#scaling-beyond-a-mesh‑brief-notes-on-sfuturn)
- [Troubleshooting](#troubleshooting)
- [License](#license)

---

## Overview
This repository contains a **minimal WebRTC video‑chat demo** built with:

| Component | Technology |
|-----------|------------|
| **Signalling server** | Flask + Flask‑SocketIO (Python) |
| **Web UI** | HTML + JavaScript (plain, no framework) |
| **STUN/TURN** | A tiny, self‑contained STUN **Binding‑Response** server written in pure Python (asyncio). |

The demo lets two or more browsers join a *named* room and exchange webcam/video streams **peer‑to‑peer** using WebRTC.  The signalling (exchange of SDP offers/answers and ICE candidates) goes through the Flask‑SocketIO server, while the STUN server helps the peers discover their public IP/port when they are behind NATs.

## Features
- **Full‑mesh** WebRTC: each participant creates a separate `RTCPeerConnection` for every other participant, so every video stream is sent directly between browsers.
- **Dynamic room creation** – any client can type an arbitrary room name and start a video chat.
- **Graceful leave** – when a user clicks **Leave**, the connection is closed and the server notifies everybody.
- **Embedded STUN server** (`mini_stun_server.py`) – demonstrates how a STUN server works and can be used by the browser (`iceServers` list) or any other client.
- **Turn server placeholder** – the code already includes a public TURN server for demo purposes; you can replace it with your own.
- **Works on local LAN and on the public Internet** (provided the ports are reachable).

## Architecture diagram
```
+-------------------+          WebSocket (signalling)            +-------------------+
|   Browser A      |  <------------------------------------->  |   Flask‑SocketIO  |
| (HTML/JS)       |                                          |   (app.py)        |
+-------------------+                                          +-------------------+
        |  ^                                                          |
        |  |  ICE candidates / SDP (via signalling)                   |
        v  |                                                          v
+-------------------+          UDP (STUN)                     +-------------------+
|   Browser B      |  <------------------------------------->  | mini_stun_server |
+-------------------+                                          +-------------------+
```
*All traffic between the browsers (audio/video) is **direct** once ICE succeeds.
*The STUN server is used only for *host* candidate discovery; it does **not** relay media.

## Prerequisites
- Python 3.8 or newer
- `pip` (Python package manager)
- A modern web browser with WebRTC support (Chrome, Edge, Firefox, Safari)
- (Optional) Access to a public IP or port‑forwarded router if you want to test across the Internet.

## Installation
```bash
# Clone the repository (or copy the files into a folder)
git clone https://github.com/your‑username/your‑repo.git
cd your‑repo

# Create a virtual environment (recommended)
python3 -m venv venv
source venv/bin/activate   # on Windows: venv\Scripts\activate

# Install Python dependencies
pip install -r requirements.txt
```
The `requirements.txt` contains:
```
Flask==3.0.3
Flask‑SocketIO==5.3.6
eventlet==0.36.1    # async worker for SocketIO
```

## Running the Flask signalling server
```bash
# Activate the virtualenv if not already active
source venv/bin/activate   # Windows: venv\Scripts\activate

# Start the server (debug mode prints lots of info)
python app.py
```
The server will listen on **`0.0.0.0:5000`** (http).  Open a browser and navigate to:
```
http://localhost:5000
```
You should see the simple UI with a room‑name input.

## Running the tiny STUN server
The repo ships with `mini_stun_server.py`, a minimal STUN Binding‑Response implementation.
```bash
# In a separate terminal (you can keep it in the same venv)
python mini_stun_server.py [--host 0.0.0.0] [--port 3478]
```
*Default* is `0.0.0.0:3478`, the standard STUN port.  The server logs each request and the public IP/port it sees.

If you plan to reach the Flask server from the Internet, make sure **UDP 3478** is forwarded from your router to the host running the STUN server.

## Connecting clients (web browsers)
1. Open the page `http://<SERVER_IP>:5000` in **two or more** browsers (different computers, phones, or separate tabs).
2. Type the **same room name** in each client and click **Join room**.
3. Grant permission for webcam/mic when the browser asks.
4. You should now see **your own video** plus the **remote video(s)** of every other participant.
5. Click **Leave room** to cleanly close the connections.

The JavaScript code (`static/main.js`) does the following for each remote participant:
- creates a dedicated `RTCPeerConnection`
- adds our local tracks to it
- exchanges SDP via Socket.IO (`offer`, `answer`)
- forwards ICE candidates
- displays the remote stream in the `<video id="remoteVideo">` element (you can extend it to create a grid of videos).

## Testing the STUN server independently
You can verify that the STUN server works without launching the Web UI.
```bash
# Install a tiny client library (optional)
pip install pystun3

python - <<'PY'
import stun
# Replace with the public IP of the machine running mini_stun_server.py
nat, external_ip, external_port = stun.get_ip_info('YOUR_STUN_IP', 3478)
print('NAT type:', nat)
print('External IP:', external_ip)
print('External Port:', external_port)
PY
```
You should see the **public IP** and **port** that the client used – exactly what the STUN server reports.

You can also send a raw UDP packet with `netcat` to view the binary response:
```bash
printf '\x00\x01\x00\x00\x21\x12\xa4\x42\x01\x02\x03\x04\x05\x06\x07\x08\x09\x0a\x0b\x0c' |
    ncat -u -w1 YOUR_STUN_IP 3478 | hexdump -C
```
The reply will contain the `MAPPED-ADDRESS` attribute showing the source IP/port.

## Multi‑person (3+ peers) walkthrough
1. **First client** creates the room – no other participants yet, so no offer is sent.
2. **Second client** joins. The server broadcasts a `joined` event to *both* clients. Each sees the other's SID, creates a `RTCPeerConnection`, and the second client (the one that just joined) becomes the *caller* and sends an **offer** to the first client.
3. **Third client** joins. The server now sends a `joined` event to **all three** participants. Each existing participant creates a new `RTCPeerConnection` for the newcomer and sends an offer. The newcomer receives offers from the two existing peers, answers each, and now has two separate connections.
4. The process repeats for any additional peers – every participant maintains **one connection per other participant** (full‑mesh).  Video for each remote peer appears in the same `<video>` element (the demo currently overwrites it – you can easily extend the `track` handler to create a grid of videos).

## Scaling beyond a mesh – brief notes on SFU/TURN
A full‑mesh works fine for 2‑4 participants on a decent broadband connection.  As the number of users grows, each client must send its video **N‑1 times**, which quickly saturates upload bandwidth.

**Solution:** introduce a **Selective Forwarding Unit (SFU)**.
- Clients send a **single** WebRTC stream to the SFU.
- The SFU forwards each received stream to the other participants (no mixing, just forwarding).
- Bandwidth per client becomes roughly **constant** regardless of room size.

Popular open‑source SFUs you can plug in:
- `mediasoup` (Node.js, very feature rich)
- `Janus` (C, many plugins)
- `ion‑SFU` / `Pion‑SFU` (Go, lightweight)
- `LiveKit` (Go + hosted SaaS option)

If NAT traversal fails (e.g., symmetric NATs, firewalls), you also need a **TURN** server that can *relay* media. The demo already includes a public TURN (`turn:openrelay.metered.ca:80`). For production you should run your own `coturn` instance and add it to the `iceServers` list in `static/main.js`.

## Troubleshooting
| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| No video appears on any side | Camera permission denied / page not served over HTTPS | Use `https://` (or `localhost`), allow camera in browser settings. |
| One side sees only its own video (one‑way connection) | Missing TURN, blocked UDP, or ICE failed in one direction | Verify that UDP 3478 (STUN) and UDP 3478/443 for TURN are reachable, or run your own TURN server. |
| `Cannot set remote answer in state stable` | Older code tried to set an answer before a local offer existed | Updated `main.js` now checks `signalingState` before applying SDP. |
| `Socket.IO connection error` | Server not reachable, CORS, or wrong port | Ensure Flask is running on `0.0.0.0:5000`, firewall allows TCP 5000, and the page uses the correct address. |
| STUN server logs “Invalid STUN packet” | Test client sent a malformed packet (e.g., wrong magic cookie) | Use a proper STUN client (pystun3, browser ICE). |

## License
This repository is released under the **MIT License** – you are free to use, modify, and distribute it.

---
*Happy hacking! 🎥🚀*
