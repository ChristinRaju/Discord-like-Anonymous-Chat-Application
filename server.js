import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());

// Dummy message reactions store (in memory)
let reactions = {
  "msg1": [
    // { emoji: "❤️", userId: "user1" }
  ]
};

// Get reactions for a message
app.get("/reactions/:messageId", (req, res) => {
  const msgId = req.params.messageId;
  res.json(reactions[msgId] || []);
});

// Toggle reaction
app.post("/reactions/:messageId", (req, res) => {
  const { emoji, userId } = req.body;
  const msgId = req.params.messageId;

  if (!reactions[msgId]) reactions[msgId] = [];

  const index = reactions[msgId].findIndex(
    (r) => r.emoji === emoji && r.userId === userId
  );

  if (index >= 0) {
    reactions[msgId].splice(index, 1); // remove reaction
  } else {
    reactions[msgId].push({ emoji, userId }); // add reaction
  }

  io.emit("reactionUpdate", { messageId: msgId, reactions: reactions[msgId] });
  res.json({ success: true });
});

// Real-time updates
io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);
});

server.listen(3000, () => console.log("🟢 Reaction server running on port 3000"));
