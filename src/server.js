const express = require("express");
const path = require("path");
const http = require("http");
const { Server } = require("socket.io");
const routes = require("./routes");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 5000;
const HOST = '0.0.0.0';

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));
app.use("/api", routes);

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

const rooms = new Map();
const shareRooms = new Map();

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  socket.on("create-room", (callback) => {
    const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    rooms.set(roomId, { host: socket.id, viewers: [] });
    socket.join(roomId);
    socket.roomId = roomId;
    socket.isHost = true;
    console.log(`Room created: ${roomId} by ${socket.id}`);
    callback({ roomId });
  });

  socket.on("join-room", (roomId, callback) => {
    const room = rooms.get(roomId);
    if (!room) {
      callback({ error: "Room tidak ditemukan" });
      return;
    }
    room.viewers.push(socket.id);
    socket.join(roomId);
    socket.roomId = roomId;
    socket.isHost = false;
    console.log(`${socket.id} joined room ${roomId}`);
    io.to(room.host).emit("viewer-joined", socket.id);
    callback({ success: true });
  });

  socket.on("offer", (data) => {
    console.log(`Offer from ${socket.id} to ${data.to}`);
    io.to(data.to).emit("offer", { offer: data.offer, from: socket.id });
  });

  socket.on("answer", (data) => {
    console.log(`Answer from ${socket.id} to ${data.to}`);
    io.to(data.to).emit("answer", { answer: data.answer, from: socket.id });
  });

  socket.on("ice-candidate", (data) => {
    io.to(data.to).emit("ice-candidate", { candidate: data.candidate, from: socket.id });
  });

  socket.on("create-share-room", (data, callback) => {
    const roomId = data.roomId;
    shareRooms.set(roomId, { 
      sender: socket.id,
      senderId: data.deviceId,
      receiver: null,
      receiverId: null,
      connected: false
    });
    socket.join(roomId);
    socket.shareRoomId = roomId;
    socket.isSender = true;
    console.log(`Share room created: ${roomId} by ${socket.id}`);
    callback({ roomId });
  });

  socket.on("join-share-room", (roomId, deviceId, callback) => {
    const room = shareRooms.get(roomId);
    if (!room) {
      callback({ error: "Room tidak ditemukan" });
      return;
    }
    if (room.receiver) {
      callback({ error: "Room sudah penuh" });
      return;
    }
    room.receiver = socket.id;
    room.receiverId = deviceId;
    room.connected = true;
    socket.join(roomId);
    socket.shareRoomId = roomId;
    socket.isSender = false;
    console.log(`${socket.id} joined share room ${roomId}`);
    io.to(room.sender).emit("receiver-connected", deviceId);
    callback({ success: true });
  });

  socket.on("file-ready", (data) => {
    const room = shareRooms.get(data.roomId);
    if (room) {
      console.log(`File ready in room ${data.roomId}, sender: ${room.sender}, receiver: ${room.receiver}`);
      if (room.receiver) {
        io.to(room.receiver).emit("file-ready", {
          fileName: data.fileName,
          fileSize: data.fileSize,
          fileType: data.fileType
        });
        console.log(`File-ready sent to receiver ${room.receiver}`);
      } else {
        console.log('No receiver found in room');
      }
    } else {
      console.log(`Room ${data.roomId} not found`);
    }
  });

  socket.on("start-transfer", (roomId) => {
    const room = shareRooms.get(roomId);
    if (room) {
      console.log(`Start transfer in room ${roomId}, sender: ${room.sender}`);
      if (room.sender) {
        io.to(room.sender).emit("start-transfer");
        console.log(`Start-transfer sent to sender ${room.sender}`);
      } else {
        console.log('No sender found in room');
      }
    } else {
      console.log(`Room ${roomId} not found`);
    }
  });

  socket.on("file-chunk", (data) => {
    const room = shareRooms.get(data.roomId);
    if (room && room.receiver) {
      io.to(room.receiver).emit("file-chunk", {
        chunk: data.chunk,
        chunkIndex: data.chunkIndex,
        totalChunks: data.totalChunks,
        fileName: data.fileName
      });
    }
  });

  socket.on("disconnect-device", (roomId) => {
    const room = shareRooms.get(roomId);
    if (room) {
      shareRooms.delete(roomId);
      io.to(roomId).emit("device-disconnected");
      console.log(`Share room ${roomId} manually disconnected`);
    }
  });

  socket.on("reconnect-device", (data) => {
    const room = shareRooms.get(data.roomId);
    if (room) {
      if (room.senderId === data.deviceId) {
        room.sender = socket.id;
        socket.shareRoomId = data.roomId;
        socket.isSender = true;
        socket.join(data.roomId);
        console.log(`Sender ${socket.id} reconnected to room ${data.roomId}`);
      } else if (room.receiverId === data.deviceId) {
        room.receiver = socket.id;
        socket.shareRoomId = data.roomId;
        socket.isSender = false;
        socket.join(data.roomId);
        console.log(`Receiver ${socket.id} reconnected to room ${data.roomId}`);
      }
    }
  });

  socket.on("switch-role", (data) => {
    const room = shareRooms.get(data.roomId);
    if (!room) return;
    
    const isSender = (room.senderId === data.deviceId);
    const peerId = isSender ? room.receiverId : room.senderId;
    
    // Find peer's current socket by iterating room members
    let peerSocketId = null;
    const roomSockets = io.sockets.adapter.rooms.get(data.roomId);
    if (roomSockets) {
      for (const sid of roomSockets) {
        if (sid !== socket.id) {
          peerSocketId = sid;
          break;
        }
      }
    }
    
    if (data.newRole === 'send') {
      room.senderId = data.deviceId;
      room.sender = socket.id;
      room.receiverId = peerId;
      room.receiver = peerSocketId;
      socket.isSender = true;
    } else {
      room.receiverId = data.deviceId;
      room.receiver = socket.id;
      room.senderId = peerId;
      room.sender = peerSocketId;
      socket.isSender = false;
    }
    
    console.log(`switch-role room=${data.roomId}: sender=${room.senderId}(${room.sender}) receiver=${room.receiverId}(${room.receiver})`);
    
    io.to(data.roomId).emit("role-switched", {
      deviceId: data.deviceId,
      newRole: data.newRole
    });
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
    if (socket.roomId) {
      const room = rooms.get(socket.roomId);
      if (room) {
        if (socket.isHost) {
          io.to(socket.roomId).emit("host-disconnected");
          rooms.delete(socket.roomId);
          console.log(`Room ${socket.roomId} deleted`);
        } else {
          room.viewers = room.viewers.filter(id => id !== socket.id);
          io.to(room.host).emit("viewer-left", socket.id);
        }
      }
    }
    if (socket.shareRoomId) {
      const room = shareRooms.get(socket.shareRoomId);
      if (room) {
        // Find peer's current socket ID before cleanup
        const roomSockets = io.sockets.adapter.rooms.get(socket.shareRoomId);
        let peerSocketId = null;
        if (roomSockets) {
          for (const sid of roomSockets) {
            if (sid !== socket.id) peerSocketId = sid;
          }
        }
        
        if (socket.isSender) {
          if (peerSocketId) {
            io.to(peerSocketId).emit("sender-disconnected");
          }
          shareRooms.delete(socket.shareRoomId);
          console.log(`Share room ${socket.shareRoomId} deleted (sender disconnected)`);
        } else {
          if (peerSocketId) {
            io.to(peerSocketId).emit("receiver-disconnected");
          }
          // Clear stale reference
          room.receiver = null;
          room.receiverId = null;
          room.connected = false;
          console.log(`Share room ${socket.shareRoomId} receiver disconnected, room kept`);
        }
      }
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`\n  ShortLink Bypass running at http://${HOST}:${PORT}\n`);
});
