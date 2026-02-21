const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const cors = require("cors");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(cors());
app.use(express.static("public"));
app.use("/uploads", express.static("uploads"));

if (!fs.existsSync("uploads")) fs.mkdirSync("uploads");

const storage = multer.diskStorage({
  destination: "uploads/",
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

const rooms = {};

app.post("/upload", upload.single("song"), (req, res) => {
  res.json({ url: `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}` });
});

io.on("connection", (socket) => {
  socket.on("getServerTime", () => socket.emit("serverTime", Date.now()));

  socket.on("joinRoom", (room) => {
    if (!rooms[room]) {
      rooms[room] = { host: socket.id, users: [], queue: [], readyUsers: [], startedAt: null, isPlaying: false };
    }
    rooms[room].users.push(socket.id);
    socket.join(room);
    socket.emit("role", { isHost: rooms[room].host === socket.id });
    io.to(room).emit("userList", rooms[room].users);
  });

  socket.on("addToQueue", ({ room, trackUrl }) => {
    if (rooms[room]) {
      rooms[room].queue.push(trackUrl);
      io.to(room).emit("queueUpdate", rooms[room].queue);
    }
  });

  socket.on("playNext", (room) => {
    if (rooms[room] && rooms[room].queue.length > 0) {
      const track = rooms[room].queue.shift();
      rooms[room].readyUsers = [];
      io.to(room).emit("queueUpdate", rooms[room].queue);
      io.to(room).emit("preloadTrack", track);
    }
  });

  socket.on("clientReady", (room) => {
    if (!rooms[room]) return;
    rooms[room].readyUsers.push(socket.id);
    if (rooms[room].readyUsers.length === rooms[room].users.length) {
      const startTime = Date.now() + 5000;
      rooms[room].startedAt = startTime;
      rooms[room].isPlaying = true;
      io.to(room).emit("startPlayback", startTime);
    }
  });

  setInterval(() => {
    for (let r in rooms) {
      if (rooms[r].isPlaying) io.to(r).emit("syncPosition", { startedAt: rooms[r].startedAt });
    }
  }, 5000);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Backend running on port ${PORT}`));