const socket = io();
let localStream = null;
let peerConnections = new Map();
let currentRoomId = null;
let mirrorMode = 'host';

const iceServers = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

function setMirrorMode(mode) {
  mirrorMode = mode;
  document.getElementById('btnModeHost').classList.toggle('active', mode === 'host');
  document.getElementById('btnModeView').classList.toggle('active', mode === 'view');
  document.getElementById('mirrorHost').classList.toggle('hidden', mode !== 'host');
  document.getElementById('mirrorView').classList.toggle('hidden', mode !== 'view');
  
  if (localStream) {
    stopSharing();
  }
}

function setMirrorStatus(msg, type = "") {
  const s = document.getElementById('mirrorStatus');
  if (!msg) { s.classList.add('hidden'); return; }
  s.textContent = msg;
  s.className = 'status ' + type;
  s.classList.remove('hidden');
}

function setViewerStatus(msg, type = "") {
  const s = document.getElementById('viewerStatus');
  if (!msg) { s.classList.add('hidden'); return; }
  s.textContent = msg;
  s.className = 'status ' + type;
  s.classList.remove('hidden');
}

async function startSharing() {
  try {
    setMirrorStatus('Meminta akses layar...', 'loading');
    
    localStream = await navigator.mediaDevices.getDisplayMedia({
      video: { 
        cursor: 'always',
        displaySurface: 'monitor'
      },
      audio: true
    });

    document.getElementById('localVideo').srcObject = localStream;
    document.getElementById('localPreview').classList.remove('hidden');
    
    localStream.getVideoTracks()[0].onended = () => {
      stopSharing();
    };

    socket.emit('create-room', (response) => {
      currentRoomId = response.roomId;
      document.getElementById('roomCodeText').textContent = currentRoomId;
      document.getElementById('roomCodeDisplay').classList.remove('hidden');
      document.getElementById('viewerCount').classList.remove('hidden');
      document.getElementById('btnStartShare').disabled = true;
      document.getElementById('btnStartShare').innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/></svg>Sedang Share...';
      setMirrorStatus('Share layar aktif! Bagikan kode room ke viewer.', 'organic');
    });
  } catch (err) {
    setMirrorStatus('Gagal mengakses layar: ' + err.message, 'error');
    console.error('Error accessing display media:', err);
  }
}

function stopSharing() {
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
  
  peerConnections.forEach(pc => pc.close());
  peerConnections.clear();
  
  document.getElementById('localVideo').srcObject = null;
  document.getElementById('localPreview').classList.add('hidden');
  document.getElementById('roomCodeDisplay').classList.add('hidden');
  document.getElementById('viewerCount').classList.add('hidden');
  document.getElementById('btnStartShare').disabled = false;
  document.getElementById('btnStartShare').innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="m8 12 4 4 4-4"/></svg>Mulai Share Layar';
  setMirrorStatus('', '');
  currentRoomId = null;
}

async function joinRoom() {
  const roomId = document.getElementById('roomCodeInput').value.trim().toUpperCase();
  if (!roomId) {
    setViewerStatus('Masukkan kode room', 'error');
    return;
  }

  setViewerStatus('Bergabung ke room...', 'loading');
  
  socket.emit('join-room', roomId, async (response) => {
    if (response.error) {
      setViewerStatus(response.error, 'error');
      return;
    }
    
    currentRoomId = roomId;
    document.getElementById('btnJoinRoom').disabled = true;
    document.getElementById('roomCodeInput').disabled = true;
    setViewerStatus('Menunggu stream dari host...', 'loading');
  });
}

socket.on('viewer-joined', async (viewerId) => {
  console.log('Viewer joined:', viewerId);
  
  const pc = new RTCPeerConnection(iceServers);
  peerConnections.set(viewerId, pc);
  
  localStream.getTracks().forEach(track => {
    pc.addTrack(track, localStream);
  });
  
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('ice-candidate', {
        candidate: event.candidate,
        to: viewerId
      });
    }
  };
  
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  
  socket.emit('offer', {
    offer: offer,
    to: viewerId
  });
  
  updateViewerCount();
});

socket.on('offer', async (data) => {
  console.log('Received offer from:', data.from);
  
  const pc = new RTCPeerConnection(iceServers);
  peerConnections.set(data.from, pc);
  
  pc.ontrack = (event) => {
    console.log('Received remote track');
    document.getElementById('remoteVideo').srcObject = event.streams[0];
    document.getElementById('remotePreview').classList.remove('hidden');
    setViewerStatus('Terhubung! Menampilkan layar host.', 'organic');
  };
  
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('ice-candidate', {
        candidate: event.candidate,
        to: data.from
      });
    }
  };
  
  await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  
  socket.emit('answer', {
    answer: answer,
    to: data.from
  });
});

socket.on('answer', async (data) => {
  console.log('Received answer from:', data.from);
  const pc = peerConnections.get(data.from);
  if (pc) {
    await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
  }
});

socket.on('ice-candidate', async (data) => {
  const pc = peerConnections.get(data.from);
  if (pc) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch (err) {
      console.error('Error adding ICE candidate:', err);
    }
  }
});

socket.on('viewer-left', (viewerId) => {
  console.log('Viewer left:', viewerId);
  const pc = peerConnections.get(viewerId);
  if (pc) {
    pc.close();
    peerConnections.delete(viewerId);
  }
  updateViewerCount();
});

socket.on('host-disconnected', () => {
  setViewerStatus('Host telah disconnect', 'error');
  document.getElementById('remoteVideo').srcObject = null;
  document.getElementById('remotePreview').classList.add('hidden');
  document.getElementById('btnJoinRoom').disabled = false;
  document.getElementById('roomCodeInput').disabled = false;
  document.getElementById('roomCodeInput').value = '';
  peerConnections.forEach(pc => pc.close());
  peerConnections.clear();
  currentRoomId = null;
});

function updateViewerCount() {
  const count = peerConnections.size;
  document.getElementById('viewerCountText').textContent = count + ' viewer' + (count !== 1 ? 's' : '');
}

function copyRoomCode() {
  const code = document.getElementById('roomCodeText').textContent;
  navigator.clipboard.writeText(code).then(() => {
    const btn = event.target.closest('.copy-btn');
    btn.textContent = 'Copied!';
    setTimeout(() => {
      btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copy';
    }, 2000);
  });
}

document.getElementById('roomCodeInput').addEventListener('input', (e) => {
  e.target.value = e.target.value.toUpperCase();
});

document.getElementById('roomCodeInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinRoom();
});
