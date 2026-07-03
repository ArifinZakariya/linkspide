const socket = io();
let currentShareRoom = null;
let selectedFile = null;
let shareMode = 'send';
let receivedFileData = null;
let isConnected = false;
let connectedDeviceId = null;
let qrCodeReader = null;
let scannerStream = null;

function checkConnection() {
  const savedDevice = localStorage.getItem('connectedDevice');
  if (savedDevice) {
    const device = JSON.parse(savedDevice);
    connectedDeviceId = device.id;
    currentShareRoom = device.roomId;
    isConnected = true;
    
    const peerName = device.peerName || 'Connected Device';
    const peerId = device.peerId || device.id;
    showDeviceStatus(peerName, peerId);
    
    socket.emit('reconnect-device', {
      roomId: device.roomId,
      deviceId: device.id
    });
  }
}

function showDeviceStatus(name, id) {
  document.getElementById('connectedDeviceName').textContent = name;
  document.getElementById('connectedDeviceId').textContent = 'ID: ' + id.substring(0, 8);
  document.getElementById('deviceStatus').classList.remove('hidden');
  
  document.getElementById('sendDescription').textContent = 'Device connected. Pilih file untuk kirim.';
  document.getElementById('receiveDescription').textContent = 'Device connected. Siap menerima file.';
  
  document.getElementById('btnGenerateQR').classList.add('hidden');
  document.getElementById('btnStartScan').classList.add('hidden');
  
  if (shareMode === 'send') {
    document.getElementById('fileSelectSection').classList.remove('hidden');
  }
}

function disconnectDevice() {
  localStorage.removeItem('connectedDevice');
  isConnected = false;
  connectedDeviceId = null;
  document.getElementById('deviceStatus').classList.add('hidden');
  
  if (currentShareRoom) {
    socket.emit('disconnect-device', currentShareRoom);
  }
  
  location.reload();
}

function setShareMode(mode) {
  const previousMode = shareMode;
  shareMode = mode;
  document.getElementById('btnModeSend').classList.toggle('active', mode === 'send');
  document.getElementById('btnModeReceive').classList.toggle('active', mode === 'receive');
  document.getElementById('shareSend').classList.toggle('hidden', mode !== 'send');
  document.getElementById('shareReceive').classList.toggle('hidden', mode !== 'receive');
  
  if (isConnected && currentShareRoom && previousMode !== mode) {
    resetTransferState();
    
    socket.emit('switch-role', {
      roomId: currentShareRoom,
      deviceId: connectedDeviceId,
      newRole: mode
    });
    
    if (mode === 'send') {
      document.getElementById('fileSelectSection').classList.remove('hidden');
      setShareStatus('Switched to sender mode. Ready to send files.', 'organic');
    } else {
      document.getElementById('fileSelectSection').classList.add('hidden');
      setReceiveStatus('Switched to receiver mode. Ready to receive files.', 'organic');
    }
  } else if (!isConnected) {
    resetShareState();
  }
}

function resetTransferState() {
  selectedFile = null;
  receivedFileData = null;
  
  document.getElementById('fileInfo').classList.add('hidden');
  document.getElementById('transferProgress').classList.add('hidden');
  document.getElementById('transferFill').style.width = '0%';
  document.getElementById('transferText').textContent = '0%';
  
  document.getElementById('receiveFileInfo').classList.add('hidden');
  document.getElementById('receiveProgress').classList.add('hidden');
  document.getElementById('receiveFill').style.width = '0%';
  document.getElementById('receiveText').textContent = '0%';
  document.getElementById('btnDownloadFile').disabled = true;
  
  document.getElementById('fileInput').value = '';
}

function resetShareState() {
  resetTransferState();
  
  document.getElementById('qrCodeDisplay').classList.add('hidden');
  document.getElementById('videoContainer').classList.add('hidden');
  setShareStatus('', '');
  setReceiveStatus('', '');
  
  if (!isConnected) {
    document.getElementById('fileSelectSection').classList.add('hidden');
    document.getElementById('btnGenerateQR').classList.remove('hidden');
    document.getElementById('btnStartScan').classList.remove('hidden');
  }
}

window.addEventListener('load', checkConnection);

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

function generateQRCode() {
  setShareStatus('Generating QR Code...', 'loading');
  
  const deviceId = 'sender_' + Math.random().toString(36).substring(2, 15);
  const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
  
  socket.emit('create-share-room', {
    deviceId: deviceId,
    roomId: roomId
  }, (response) => {
    currentShareRoom = response.roomId;
    connectedDeviceId = deviceId;
    
    const qrData = JSON.stringify({
      type: 'linksniper-share',
      roomId: currentShareRoom,
      senderId: deviceId
    });
    
    const qrContainer = document.getElementById('qrCodeCanvas');
    qrContainer.innerHTML = '';
    
    setTimeout(() => {
      try {
        new QRCode(qrContainer, {
          text: qrData,
          width: 256,
          height: 256,
          colorDark: '#6d5dfc',
          colorLight: '#ffffff',
          correctLevel: QRCode.CorrectLevel.H
        });
        
        document.getElementById('qrCodeDisplay').classList.remove('hidden');
        document.getElementById('btnGenerateQR').classList.add('hidden');
        setShareStatus('QR Code generated. Waiting for receiver to scan...', 'organic');
      } catch (err) {
        console.error('QR Code generation error:', err);
        setShareStatus('Failed to generate QR Code. Try again.', 'error');
        document.getElementById('btnGenerateQR').classList.remove('hidden');
      }
    }, 100);
  });
}

function startQRScan() {
  setReceiveStatus('Starting camera...', 'loading');
  
  if (typeof ZXing === 'undefined') {
    setReceiveStatus('QR Scanner library not loaded. Please refresh page.', 'error');
    return;
  }
  
  const constraints = {
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1280 },
      height: { ideal: 720 }
    }
  };
  
  navigator.mediaDevices.getUserMedia(constraints).then(stream => {
    scannerStream = stream;
    const video = document.getElementById('scannerVideo');
    video.srcObject = stream;
    video.setAttribute('playsinline', 'true');
    document.getElementById('videoContainer').classList.remove('hidden');
    document.getElementById('btnStartScan').classList.add('hidden');
    
    video.onloadedmetadata = () => {
      video.play();
      
      if ('BarcodeDetector' in window) {
        scanWithBarcodeDetector(video);
      } else {
        scanWithZXing(video);
      }
      
      setReceiveStatus('Scan QR code from sender...', 'loading');
    };
  }).catch(err => {
    console.error('Camera error:', err);
    navigator.mediaDevices.getUserMedia({ video: true }).then(fallbackStream => {
      scannerStream = fallbackStream;
      const video = document.getElementById('scannerVideo');
      video.srcObject = fallbackStream;
      video.setAttribute('playsinline', 'true');
      document.getElementById('videoContainer').classList.remove('hidden');
      document.getElementById('btnStartScan').classList.add('hidden');
      
      video.onloadedmetadata = () => {
        video.play();
        if ('BarcodeDetector' in window) {
          scanWithBarcodeDetector(video);
        } else {
          scanWithZXing(video);
        }
        setReceiveStatus('Scan QR code from sender...', 'loading');
      };
    }).catch(fallbackErr => {
      setReceiveStatus('Camera access denied: ' + fallbackErr.message, 'error');
      document.getElementById('btnStartScan').classList.remove('hidden');
    });
  });
}

function scanWithBarcodeDetector(video) {
  const barcodeDetector = new BarcodeDetector({ formats: ['qr_code'] });
  
  async function scanFrame() {
    if (!scannerStream) return;
    try {
      const barcodes = await barcodeDetector.detect(video);
      if (barcodes.length > 0) {
        const result = barcodes[0].rawValue;
        try {
          const data = JSON.parse(result);
          if (data.type === 'linksniper-share') {
            handleQRScanned(data);
            return;
          }
        } catch (e) {}
      }
    } catch (e) {}
    if (scannerStream) {
      requestAnimationFrame(scanFrame);
    }
  }
  scanFrame();
}

function scanWithZXing(video) {
  qrCodeReader = new ZXing.BrowserQRCodeReader();
  
  qrCodeReader.decodeFromVideoDevice(null, video, (result, err) => {
    if (result) {
      try {
        const data = JSON.parse(result.text);
        if (data.type === 'linksniper-share') {
          handleQRScanned(data);
        }
      } catch (e) {}
    }
  });
}

function stopQRScan() {
  if (scannerStream) {
    scannerStream.getTracks().forEach(track => track.stop());
    scannerStream = null;
  }
  if (qrCodeReader) {
    try { qrCodeReader.reset(); } catch(e) {}
    qrCodeReader = null;
  }
  document.getElementById('videoContainer').classList.add('hidden');
  document.getElementById('btnStartScan').classList.remove('hidden');
  setReceiveStatus('', '');
}

function handleQRScanned(data) {
  stopQRScan();
  setReceiveStatus('Connecting to sender...', 'loading');
  
  const deviceId = 'receiver_' + Math.random().toString(36).substring(2, 15);
  
  socket.emit('join-share-room', data.roomId, deviceId, (response) => {
    if (response.error) {
      setReceiveStatus(response.error, 'error');
      return;
    }
    
    currentShareRoom = data.roomId;
    connectedDeviceId = deviceId;
    isConnected = true;
    shareMode = 'receive';
    
    localStorage.setItem('connectedDevice', JSON.stringify({
      id: deviceId,
      name: 'Receiver Device',
      roomId: data.roomId,
      peerId: data.senderId,
      peerName: 'Sender Device'
    }));
    
    document.getElementById('btnModeSend').classList.remove('active');
    document.getElementById('btnModeReceive').classList.add('active');
    document.getElementById('shareSend').classList.add('hidden');
    document.getElementById('shareReceive').classList.remove('hidden');
    
    showDeviceStatus('Sender Device', data.senderId);
    setReceiveStatus('Connected! Waiting for files...', 'organic');
  });
}

function handleFileSelect(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  selectedFile = file;
  document.getElementById('fileName').textContent = file.name;
  document.getElementById('fileSize').textContent = formatFileSize(file.size);
  document.getElementById('fileInfo').classList.remove('hidden');
  
  if (isConnected && currentShareRoom) {
    setShareStatus('Ready to send. Notifying receiver...', 'organic');
    socket.emit('file-ready', {
      roomId: currentShareRoom,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type
    });
  }
}

socket.on('receiver-connected', (receiverId) => {
  console.log('Receiver connected:', receiverId);
  
  isConnected = true;
  
  const deviceData = {
    id: connectedDeviceId,
    name: 'Sender Device',
    roomId: currentShareRoom,
    peerId: receiverId,
    peerName: 'Connected Device'
  };
  
  localStorage.setItem('connectedDevice', JSON.stringify(deviceData));
  
  showDeviceStatus(deviceData.peerName, receiverId);
  setShareStatus('Receiver connected! Select file to send.', 'organic');
  
  document.getElementById('qrCodeDisplay').classList.add('hidden');
  document.getElementById('fileSelectSection').classList.remove('hidden');
});

socket.on('file-ready', (data) => {
  console.log('File ready:', data);
  document.getElementById('receiveFileName').textContent = data.fileName;
  document.getElementById('receiveFileSize').textContent = formatFileSize(data.fileSize);
  document.getElementById('receiveFileInfo').classList.remove('hidden');
  setReceiveStatus('File incoming. Ready to receive...', 'organic');
  
  socket.emit('start-transfer', currentShareRoom);
});

socket.on('start-transfer', () => {
  if (!selectedFile) {
    setShareStatus('No file selected. Please select a file first.', 'error');
    return;
  }
  
  setShareStatus('Sending file...', 'loading');
  document.getElementById('transferProgress').classList.remove('hidden');
  
  sendFile();
});

function sendFile() {
  const chunkSize = 1024 * 1024; // 1MB chunks
  const totalChunks = Math.ceil(selectedFile.size / chunkSize);
  let currentChunk = 0;
  
  const reader = new FileReader();
  
  reader.onload = function(e) {
    if (!currentShareRoom) return;
    
    socket.emit('file-chunk', {
      roomId: currentShareRoom,
      chunk: e.target.result,
      chunkIndex: currentChunk,
      totalChunks: totalChunks,
      fileName: selectedFile.name
    });
    
    currentChunk++;
    const progress = Math.round((currentChunk / totalChunks) * 100);
    document.getElementById('transferFill').style.width = progress + '%';
    document.getElementById('transferText').textContent = progress + '%';
    
    if (currentChunk < totalChunks) {
      readNextChunk();
    } else {
      setShareStatus('File sent successfully!', 'organic');
      setTimeout(() => {
        resetTransferState();
        setShareStatus('Ready to send another file.', 'organic');
      }, 2000);
    }
  };
  
  reader.onerror = function() {
    setShareStatus('Error reading file', 'error');
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
  if (shareMode !== 'receive') return;
  
  if (!receivedFileData) {
    receivedFileData = {
      chunks: [],
      totalChunks: data.totalChunks,
      fileName: data.fileName || 'file'
    };
    document.getElementById('receiveProgress').classList.remove('hidden');
  }
  
  receivedFileData.chunks[data.chunkIndex] = data.chunk;
  
  const progress = Math.round(((data.chunkIndex + 1) / data.totalChunks) * 100);
  document.getElementById('receiveFill').style.width = progress + '%';
  document.getElementById('receiveText').textContent = progress + '%';
  
  if (data.chunkIndex + 1 === data.totalChunks) {
    setReceiveStatus('File received! Click download to save.', 'organic');
    document.getElementById('btnDownloadFile').disabled = false;
    document.getElementById('receiveFileName').textContent = data.fileName || receivedFileData.fileName;
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
  
  setReceiveStatus('File downloaded successfully!', 'organic');
  
  setTimeout(() => {
    resetTransferState();
    setReceiveStatus('Ready to receive next file.', 'organic');
  }, 2000);
}

socket.on('sender-disconnected', () => {
  setReceiveStatus('Sender disconnected', 'error');
});

socket.on('receiver-disconnected', () => {
  setShareStatus('Receiver disconnected', 'error');
});

socket.on('role-switched', (data) => {
  console.log('Role switched:', data);
  
  // Reset transfer state
  resetTransferState();
  
  // Determine if I am the new sender or receiver
  const amSender = (data.newRole === 'send' && data.deviceId !== connectedDeviceId) ||
                   (data.newRole === 'receive' && data.deviceId === connectedDeviceId);
  
  if (amSender) {
    // I am now the sender
    shareMode = 'send';
    document.getElementById('btnModeSend').classList.add('active');
    document.getElementById('btnModeReceive').classList.remove('active');
    document.getElementById('shareSend').classList.remove('hidden');
    document.getElementById('shareReceive').classList.add('hidden');
    document.getElementById('fileSelectSection').classList.remove('hidden');
    setShareStatus('Role switched. You are now the sender. Select a file.', 'organic');
  } else {
    // I am now the receiver
    shareMode = 'receive';
    document.getElementById('btnModeSend').classList.remove('active');
    document.getElementById('btnModeReceive').classList.add('active');
    document.getElementById('shareSend').classList.add('hidden');
    document.getElementById('shareReceive').classList.remove('hidden');
    document.getElementById('fileSelectSection').classList.add('hidden');
    setReceiveStatus('Role switched. You are now the receiver. Ready to receive files.', 'organic');
  }
  
  // Update localStorage
  const savedDevice = localStorage.getItem('connectedDevice');
  if (savedDevice) {
    const device = JSON.parse(savedDevice);
    device.role = amSender ? 'send' : 'receive';
    localStorage.setItem('connectedDevice', JSON.stringify(device));
  }
});

socket.on('disconnect', () => {
  console.log('Socket disconnected');
});

socket.on('connect', () => {
  console.log('Socket connected');
  if (currentShareRoom && connectedDeviceId) {
    socket.emit('reconnect-device', {
      roomId: currentShareRoom,
      deviceId: connectedDeviceId
    });
  }
});
