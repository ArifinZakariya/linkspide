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
      const targetId = room.receiver || room.receiverId;
      if (targetId) {
        io.to(room.receiver).emit("file-ready", {
          fileName: data.fileName,
          fileSize: data.fileSize,
          fileType: data.fileType
        });
      }
    }
  });

  socket.on("start-transfer", (roomId) => {
    const room = shareRooms.get(roomId);
    if (room) {
      const targetId = room.sender || room.senderId;
      if (targetId) {
        io.to(room.sender).emit("start-transfer");
      }
    }
  });

  socket.on("file-chunk", (data) => {
    const room = shareRooms.get(data.roomId);
    if (room) {
      const targetId = room.receiver || room.receiverId;
      if (targetId) {
        io.to(room.receiver).emit("file-chunk", {
          chunk: data.chunk,
          chunkIndex: data.chunkIndex,
          totalChunks: data.totalChunks
        });
      }
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
    if (room) {
      if (data.newRole === 'send') {
        if (room.receiverId === data.deviceId) {
          room.receiver = null;
          room.sender = socket.id;
          room.senderId = data.deviceId;
          socket.isSender = true;
          console.log(`Device ${data.deviceId} switched to sender in room ${data.roomId}`);
        }
      } else if (data.newRole === 'receive') {
        if (room.senderId === data.deviceId) {
          room.sender = null;
          room.receiver = socket.id;
          room.receiverId = data.deviceId;
          socket.isSender = false;
          console.log(`Device ${data.deviceId} switched to receiver in room ${data.roomId}`);
        }
      }
      
      io.to(data.roomId).emit("role-switched", {
        deviceId: data.deviceId,
        newRole: data.newRole
      });
    }
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
      if (room && !room.connected) {
        if (socket.isSender) {
          io.to(socket.shareRoomId).emit("sender-disconnected");
          shareRooms.delete(socket.shareRoomId);
          console.log(`Share room ${socket.shareRoomId} deleted`);
        } else {
          io.to(room.sender).emit("receiver-disconnected");
        }
      }
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`\n  ShortLink Bypass running at http://${HOST}:${PORT}\n`);
});
