const socket = io();
let currentShareRoom = null;
let selectedFile = null;
let shareMode = 'send';
let receivedFileData = null;

function setShareMode(mode) {
  shareMode = mode;
  document.getElementById('btnModeSend').classList.toggle('active', mode === 'send');
  document.getElementById('btnModeReceive').classList.toggle('active', mode === 'receive');
  document.getElementById('shareSend').classList.toggle('hidden', mode !== 'send');
  document.getElementById('shareReceive').classList.toggle('hidden', mode !== 'receive');
  
  resetShareState();
}

function resetShareState() {
  selectedFile = null;
  currentShareRoom = null;
  receivedFileData = null;
  
  document.getElementById('fileInfo').classList.add('hidden');
  document.getElementById('shareRoomDisplay').classList.add('hidden');
  document.getElementById('transferProgress').classList.add('hidden');
  document.getElementById('receiveFileInfo').classList.add('hidden');
  document.getElementById('receiveProgress').classList.add('hidden');
  setShareStatus('', '');
  setReceiveStatus('', '');
}

function setShareStatus(msg, type = "") {
  const s = document.getElementById('shareStatus');
  if (!msg) { s.classList.add('hidden'); return; }
  s.textContent = msg;
  s.className = 'status ' + type;
  s.classList.remove('hidden');
}

function setReceiveStatus(msg, type = "") {
  const s = document.getElementById('receiveStatus');
  if (!msg) { s.classList.add('hidden'); return; }
  s.textContent = msg;
  s.className = 'status ' + type;
  s.classList.remove('hidden');
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
}

function handleFileSelect(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  selectedFile = file;
  document.getElementById('fileName').textContent = file.name;
  document.getElementById('fileSize').textContent = formatFileSize(file.size);
  document.getElementById('fileInfo').classList.remove('hidden');
  
  createShareRoom();
}

function createShareRoom() {
  setShareStatus('Membuat room...', 'loading');
  
  socket.emit('create-share-room', {
    fileName: selectedFile.name,
    fileSize: selectedFile.size,
    fileType: selectedFile.type
  }, (response) => {
    currentShareRoom = response.roomId;
    document.getElementById('shareRoomCode').textContent = currentShareRoom;
    document.getElementById('shareRoomDisplay').classList.remove('hidden');
    setShareStatus('Room dibuat! Bagikan kode ke penerima.', 'organic');
  });
}

function copyShareCode() {
  const code = document.getElementById('shareRoomCode').textContent;
  navigator.clipboard.writeText(code).then(() => {
    const btn = event.target.closest('.copy-btn');
    btn.textContent = 'Copied!';
    setTimeout(() => {
      btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copy';
    }, 2000);
  });
}

function joinShareRoom() {
  const roomId = document.getElementById('receiveCodeInput').value.trim().toUpperCase();
  if (!roomId) {
    setReceiveStatus('Masukkan kode room', 'error');
    return;
  }

  setReceiveStatus('Bergabung ke room...', 'loading');
  
  socket.emit('join-share-room', roomId, (response) => {
    if (response.error) {
      setReceiveStatus(response.error, 'error');
      return;
    }
    
    currentShareRoom = roomId;
    document.getElementById('btnJoinShare').disabled = true;
    document.getElementById('receiveCodeInput').disabled = true;
    
    document.getElementById('receiveFileName').textContent = response.fileName;
    document.getElementById('receiveFileSize').textContent = formatFileSize(response.fileSize);
    document.getElementById('receiveFileInfo').classList.remove('hidden');
    setReceiveStatus('Terhubung! Siap menerima file.', 'organic');
  });
}

socket.on('receiver-joined', (receiverId) => {
  console.log('Receiver joined:', receiverId);
  setShareStatus('Penerima bergabung! Mengirim file...', 'loading');
  document.getElementById('transferProgress').classList.remove('hidden');
  
  sendFile(receiverId);
});

function sendFile(receiverId) {
  const chunkSize = 16384;
  const totalChunks = Math.ceil(selectedFile.size / chunkSize);
  let currentChunk = 0;
  
  const reader = new FileReader();
  
  reader.onload = function(e) {
    socket.emit('file-chunk', {
      to: receiverId,
      chunk: e.target.result,
      chunkIndex: currentChunk,
      totalChunks: totalChunks
    });
    
    currentChunk++;
    const progress = Math.round((currentChunk / totalChunks) * 100);
    document.getElementById('transferFill').style.width = progress + '%';
    document.getElementById('transferText').textContent = progress + '%';
    
    if (currentChunk < totalChunks) {
      readNextChunk();
    } else {
      setShareStatus('File terkirim!', 'organic');
    }
  };
  
  function readNextChunk() {
    const start = currentChunk * chunkSize;
    const end = Math.min(start + chunkSize, selectedFile.size);
    const blob = selectedFile.slice(start, end);
    reader.readAsArrayBuffer(blob);
  }
  
  readNextChunk();
}

socket.on('file-chunk', (data) => {
  if (!receivedFileData) {
    receivedFileData = {
      chunks: [],
      totalChunks: data.totalChunks
    };
    document.getElementById('receiveProgress').classList.remove('hidden');
  }
  
  receivedFileData.chunks[data.chunkIndex] = data.chunk;
  
  const progress = Math.round(((data.chunkIndex + 1) / data.totalChunks) * 100);
  document.getElementById('receiveFill').style.width = progress + '%';
  document.getElementById('receiveText').textContent = progress + '%';
  
  if (data.chunkIndex + 1 === data.totalChunks) {
    setReceiveStatus('File diterima! Klik download untuk menyimpan.', 'organic');
    document.getElementById('btnDownloadFile').disabled = false;
  }
});

function downloadFile() {
  if (!receivedFileData) return;
  
  const blob = new Blob(receivedFileData.chunks);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = document.getElementById('receiveFileName').textContent;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  setReceiveStatus('File berhasil didownload!', 'organic');
}

socket.on('sender-disconnected', () => {
  setReceiveStatus('Pengirim disconnect', 'error');
  document.getElementById('btnJoinShare').disabled = false;
  document.getElementById('receiveCodeInput').disabled = false;
  document.getElementById('receiveCodeInput').value = '';
  currentShareRoom = null;
});

document.getElementById('receiveCodeInput').addEventListener('input', (e) => {
  e.target.value = e.target.value.toUpperCase();
});

document.getElementById('receiveCodeInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinShareRoom();
});
