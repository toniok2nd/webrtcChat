/* ----------------------------------------------------------------------
   Updated main.js – fixes "Cannot set remote answer in state stable"
   --------------------------------------------------------------- */
const socket = io();                 // connect to the Flask‑SocketIO server
let localStream = null;
let peerConn = null;
let currentRoom = null;
let isInitiator = false;   // true for the peer that creates the first offer

// ----------------------------------------------------------------------
// ICE configuration – includes a public TURN (demo). Replace with your own TURN for prod.
// ----------------------------------------------------------------------
const configuration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    {
      urls: "turn:openrelay.metered.ca:80",
      username: "openrelayproject",
      credential: "openrelayproject"
    }
  ]
};

const localVideo   = document.getElementById("localVideo");
const remoteVideo  = document.getElementById("remoteVideo");
const joinBtn      = document.getElementById("join-btn");
const leaveBtn     = document.getElementById("leave-btn");
const roomInput    = document.getElementById("room-input");
const roomLabel    = document.getElementById("room-label");
const videoContainer = document.getElementById("video-container");
const roomSelection  = document.getElementById("room-selection");

/* ----------------------------------------------------------------------
   Helper – get webcam + mic
----------------------------------------------------------------------- */
async function startLocalMedia() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
  } catch (err) {
    alert("Could not get user media: " + err);
    console.error(err);
  }
}

/* ----------------------------------------------------------------------
   Build a fresh RTCPeerConnection and hook event listeners
----------------------------------------------------------------------- */
function createPeerConnection() {
  const pc = new RTCPeerConnection(configuration);

  // Add all local tracks
  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

  // Remote‑track handling – robust against separate audio/video events
  pc.addEventListener("track", ev => {
    const remoteStream = ev.streams[0];
    if (remoteVideo.srcObject) {
      remoteStream.getTracks().forEach(t => {
        if (!remoteVideo.srcObject.getTracks().some(et => et.id === t.id)) {
          remoteVideo.srcObject.addTrack(t);
        }
      });
    } else {
      remoteVideo.srcObject = remoteStream;
    }
  });

  // ICE candidate forwarding
  pc.addEventListener("icecandidate", ({ candidate }) => {
    if (candidate) {
      socket.emit("signal", {
        room: currentRoom,
        type: "ice",
        payload: candidate
      });
    }
  });

  // Log ICE state for debugging
  pc.addEventListener("iceconnectionstatechange", () => {
    console.log("ICE connection state:", pc.iceConnectionState);
  });

  return pc;
}

/* ----------------------------------------------------------------------
   UI – Join a room
----------------------------------------------------------------------- */
joinBtn.onclick = async () => {
  const room = roomInput.value.trim();
  if (!room) { alert("Please enter a room name."); return; }

  currentRoom = room;
  roomLabel.textContent = room;
  roomSelection.style.display = "none";
  videoContainer.style.display = "block";

  await startLocalMedia();
  peerConn = createPeerConnection();

  // Tell server we want to join
  socket.emit("join", { room });

  // ---------------------------------------------------------------
  // Listener for when another participant is already present.
  // In that case we become the initiator (caller) and create an offer.
  // ---------------------------------------------------------------
  socket.off("joined");
  socket.on("joined", data => {
    if (data.sid !== socket.id) {
      console.log("Another participant already in room – becoming initiator");
      isInitiator = true;
      createAndSendOffer();
    }
  });

  // ---------------------------------------------------------------
  // Listener for the "ready" event – the server emits this when the
  // room reaches two participants. This handles the case where *we*
  // are the first user that created the room.
  // ---------------------------------------------------------------
  socket.off("ready");
  socket.on("ready", () => {
    console.log("Room ready – becoming initiator");
    isInitiator = true;
    createAndSendOffer();
  });
};

/* ----------------------------------------------------------------------
   UI – Leave a room
----------------------------------------------------------------------- */
leaveBtn.onclick = () => {
  if (peerConn) { peerConn.close(); peerConn = null; }
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  remoteVideo.srcObject = null;
  localVideo.srcObject = null;
  socket.emit("leave", { room: currentRoom });
  currentRoom = null;
  isInitiator = false;
  videoContainer.style.display = "none";
  roomSelection.style.display = "block";
  socket.off("joined");
  socket.off("ready");
};

/* ----------------------------------------------------------------------
   Offer / Answer helpers – guarded against illegal state transitions
----------------------------------------------------------------------- */
async function createAndSendOffer() {
  // Guard: only create an offer if we are in a stable state.
  if (peerConn.signalingState !== "stable") {
    console.warn("Cannot create offer – signaling state not stable:", peerConn.signalingState);
    return;
  }
  const offer = await peerConn.createOffer();
  await peerConn.setLocalDescription(offer);
  socket.emit("signal", { room: currentRoom, type: "offer", payload: offer });
}

async function handleOffer(offer) {
  // If we are already the initiator (have sent an offer), ignore.
  if (peerConn.signalingState !== "stable") {
    console.warn("Ignoring unexpected offer – signaling state:", peerConn.signalingState);
    return;
  }
  await peerConn.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await peerConn.createAnswer();
  await peerConn.setLocalDescription(answer);
  socket.emit("signal", { room: currentRoom, type: "answer", payload: answer });
}

async function handleAnswer(answer) {
  // Valid only when we have a local offer awaiting an answer.
  if (peerConn.signalingState !== "have-local-offer") {
    console.warn("Received answer in wrong state:", peerConn.signalingState);
    return;
  }
  await peerConn.setRemoteDescription(new RTCSessionDescription(answer));
}

function handleRemoteIce(candidate) {
  // ICE may arrive before or after we have a description – just add it.
  peerConn.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => console.warn("ICE add error:", e));
}

/* ----------------------------------------------------------------------
   Signalling channel (Socket.IO)
----------------------------------------------------------------------- */
socket.on("signal", async msg => {
  if (msg.sender === socket.id) return; // ignore our own messages
  const { type, payload } = msg;
  switch (type) {
    case "offer":
      await handleOffer(payload);
      break;
    case "answer":
      await handleAnswer(payload);
      break;
    case "ice":
      await handleRemoteIce(payload);
      break;
    default:
      console.warn("Unknown signal type:", type);
  }
});

socket.on("connect_error", err => {
  console.error("Socket.IO connection error:", err);
});

/* ----------------------------------------------------------------------
   Clean‑up on page unload
----------------------------------------------------------------------- */
window.addEventListener("beforeunload", () => {
  if (currentRoom) socket.emit("leave", { room: currentRoom });
});
