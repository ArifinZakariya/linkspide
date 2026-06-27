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
  });
});

server.listen(PORT, HOST, () => {
  console.log(`\n  ShortLink Bypass running at http://${HOST}:${PORT}\n`);
});
