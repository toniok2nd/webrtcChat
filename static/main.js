/* ----------------------------------------------------------------------
   Multi‑person WebRTC demo (full‑mesh) – updated main.js
----------------------------------------------------------------------- */
const socket = io();                 // connect to the Flask‑SocketIO server
let localStream = null;
let currentRoom = null;

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

// ----------------------------------------------------------------------
// UI elements
// ----------------------------------------------------------------------
const localVideo   = document.getElementById("localVideo");
const remoteContainer = document.getElementById("remoteContainer"); // will hold a video per remote peer
const joinBtn      = document.getElementById("join-btn");
const leaveBtn     = document.getElementById("leave-btn");
const roomInput    = document.getElementById("room-input");
const roomLabel    = document.getElementById("room-label");
const videoContainer = document.getElementById("video-container");
const roomSelection  = document.getElementById("room-selection");

// ----------------------------------------------------------------------
// Helper – acquire webcam/mic
// ----------------------------------------------------------------------
async function startLocalMedia() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
  } catch (err) {
    alert("Could not get user media: " + err);
    console.error(err);
  }
}

// ----------------------------------------------------------------------
// Data structures for the full‑mesh
// ----------------------------------------------------------------------
// peers[sid] = { pc: RTCPeerConnection, video: HTMLVideoElement }
const peers = {};

/**
 * Create a new RTCPeerConnection for a remote participant identified by `sid`.
 * Also create a <video> element for that peer and attach it to the DOM.
 */
function createPeerConnection(sid) {
  const pc = new RTCPeerConnection(configuration);

  // ---- attach our local tracks to this connection ----
  if (localStream) {
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  }

  // ---- video element for the remote stream ----
  const video = document.createElement('video');
  video.autoplay = true;
  video.playsInline = true;
  video.id = `remote-${sid}`;
  remoteContainer.appendChild(video);

  // When a remote track arrives, attach its stream to this video element.
  pc.addEventListener('track', ev => {
    // Most browsers fire a separate 'track' event for each track.
    // We simply set the srcObject the first time we get a stream.
    if (!video.srcObject) {
      video.srcObject = ev.streams[0];
    } else {
      // If additional tracks arrive later, add them to the existing stream.
      ev.streams[0].getTracks().forEach(t => {
        if (!video.srcObject.getTracks().some(et => et.id === t.id)) {
          video.srcObject.addTrack(t);
        }
      });
    }
  });

  // Forward ICE candidates to the other side – we include the target SID in the payload.
  pc.addEventListener('icecandidate', ({ candidate }) => {
    if (candidate) {
      socket.emit('signal', {
        room: currentRoom,
        type: 'ice',
        target: sid,               // tell the server which peer should receive it
        payload: candidate
      });
    }
  });

  // Optional: log ICE state changes for debugging
  pc.addEventListener('iceconnectionstatechange', () => {
    console.log(`ICE state for ${sid}:`, pc.iceConnectionState);
  });

  return { pc, video };
}

/**
 * Clean up a peer when they leave the room.
 */
function removePeer(sid) {
  const entry = peers[sid];
  if (!entry) return;
  // Close the RTCPeerConnection
  entry.pc.close();
  // Remove the video element from the DOM
  if (entry.video && entry.video.parentNode) {
    entry.video.parentNode.removeChild(entry.video);
  }
  delete peers[sid];
}

// ----------------------------------------------------------------------
// UI – Join a room
// ----------------------------------------------------------------------
joinBtn.onclick = async () => {
  const room = roomInput.value.trim();
  if (!room) { alert('Please enter a room name.'); return; }

  currentRoom = room;
  roomLabel.textContent = room;
  roomSelection.style.display = 'none';
  videoContainer.style.display = 'block';

  await startLocalMedia();

  // Tell the server we want to join the room
  socket.emit('join', { room });

  // Listen for other participants joining (including ourselves)
  socket.off('joined');
  socket.on('joined', data => {
    const remoteSid = data.sid;
    if (remoteSid === socket.id) return; // ignore our own broadcast

    // A new participant is present – create a connection for them.
    const { pc, video } = createPeerConnection(remoteSid);
    peers[remoteSid] = { pc, video };

    // As soon as we learn about a remote peer, we become the caller for that peer.
    // (We will send an offer immediately.)
    createAndSendOffer(remoteSid);
  });

  // When the server says the room now has two participants we also become a caller.
  // This handles the case where *we* are the first user who created the room.
  socket.off('ready');
  socket.on('ready', () => {
    // The "ready" event does not carry a specific SID, because we are the only
    // participant that just joined and there is already someone else in the room.
    // The other participant(s) have already sent us a "joined" event, so the
    // offers for them have been created there. Nothing else is required here.
    console.log('Room ready – we are the second participant (or later).');
  });

  // When a remote participant leaves, clean up.
  socket.off('left');
  socket.on('left', data => {
    const sid = data.sid;
    console.log('Participant left:', sid);
    removePeer(sid);
  });
};

// ----------------------------------------------------------------------
// UI – Leave the room (close everything)
// ----------------------------------------------------------------------
leaveBtn.onclick = () => {
  // Close all peer connections and remove their video elements.
  Object.keys(peers).forEach(sid => removePeer(sid));

  // Stop local media.
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }
  localVideo.srcObject = null;

  // Notify the server.
  socket.emit('leave', { room: currentRoom });
  currentRoom = null;

  // Reset UI.
  videoContainer.style.display = 'none';
  roomSelection.style.display = 'block';

  // Clean up listeners so a later re‑join starts fresh.
  socket.off('joined');
  socket.off('ready');
  socket.off('left');
};

// ----------------------------------------------------------------------
// Offer / Answer handling – note that we need the remote SID to know which
// RTCPeerConnection we are talking to.
// ----------------------------------------------------------------------
async function createAndSendOffer(targetSid) {
  const peer = peers[targetSid];
  if (!peer) {
    console.warn('Attempted to create offer for unknown peer', targetSid);
    return;
  }
  const pc = peer.pc;
  // Guard – only create an offer when the connection is stable.
  if (pc.signalingState !== 'stable') {
    console.warn('Cannot create offer – signaling state not stable:', pc.signalingState);
    return;
  }
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit('signal', {
    room: currentRoom,
    type: 'offer',
    target: targetSid,
    payload: offer
  });
}

async function handleOffer(offer, senderSid) {
  // If we already have a connection for this sender, use it; otherwise create one.
  let peer = peers[senderSid];
  if (!peer) {
    const created = createPeerConnection(senderSid);
    peers[senderSid] = created;
    peer = created;
  }
  const pc = peer.pc;

  // Guard – we must be in a stable state before we accept an incoming offer.
  if (pc.signalingState !== 'stable') {
    console.warn('Ignoring unexpected offer from', senderSid, 'state:', pc.signalingState);
    return;
  }

  await pc.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit('signal', {
    room: currentRoom,
    type: 'answer',
    target: senderSid,
    payload: answer
  });
}

async function handleAnswer(answer, senderSid) {
  const peer = peers[senderSid];
  if (!peer) {
    console.warn('Answer from unknown peer', senderSid);
    return;
  }
  const pc = peer.pc;
  // We should have a local offer waiting for an answer.
  if (pc.signalingState !== 'have-local-offer') {
    console.warn('Received answer in wrong state from', senderSid, pc.signalingState);
    return;
  }
  await pc.setRemoteDescription(new RTCSessionDescription(answer));
}

function handleRemoteIce(candidate, senderSid) {
  const peer = peers[senderSid];
  if (!peer) {
    console.warn('ICE from unknown peer', senderSid);
    return;
  }
  peer.pc.addIceCandidate(new RTCIceCandidate(candidate))
    .catch(e => console.warn('ICE add error from', senderSid, e));
}

// ----------------------------------------------------------------------
// Signalling channel (Socket.IO)
// ----------------------------------------------------------------------
socket.on('signal', async msg => {
  // The server forwards everything to all members except the sender.
  // `msg.sender` tells us who originally sent the payload.
  const { type, payload, sender } = msg;
  switch (type) {
    case 'offer':
      await handleOffer(payload, sender);
      break;
    case 'answer':
      await handleAnswer(payload, sender);
      break;
    case 'ice':
      handleRemoteIce(payload, sender);
      break;
    default:
      console.warn('Unknown signal type:', type);
  }
});

socket.on('connect_error', err => {
  console.error('Socket.IO connection error:', err);
});

// ----------------------------------------------------------------------
// Clean‑up on page unload (in case the user closes the tab without clicking Leave)
// ----------------------------------------------------------------------
window.addEventListener('beforeunload', () => {
  if (currentRoom) socket.emit('leave', { room: currentRoom });
});
