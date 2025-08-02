import React, { useEffect, useState } from "react";
import axios from "axios";
import { io } from "socket.io-client";

const socket = io("http://localhost:3000");
const EMOJIS = ["❤️", "😂", "👍"];

function ReactionBox({ messageId, userId }) {
  const [reactions, setReactions] = useState([]);

  useEffect(() => {
    // Load initial reactions
    axios.get(`http://localhost:3000/reactions/${messageId}`).then(res => {
      setReactions(res.data);
    });

    // Listen for live updates
    socket.on("reactionUpdate", ({ messageId: id, reactions }) => {
      if (id === messageId) setReactions(reactions);
    });

    return () => socket.off("reactionUpdate");
  }, [messageId]);

  const toggleReaction = async (emoji) => {
    await axios.post(`http://localhost:3000/reactions/${messageId}`, {
      emoji,
      userId,
    });
  };

  const getCount = (emoji) =>
    reactions.filter((r) => r.emoji === emoji).length;

  const hasReacted = (emoji) =>
    reactions.some((r) => r.emoji === emoji && r.userId === userId);

  return (
    <div style={{ display: "flex", gap: "1rem" }}>
      {EMOJIS.map((emoji) => (
        <button
          key={emoji}
          onClick={() => toggleReaction(emoji)}
          style={{
            background: hasReacted(emoji) ? "#ef4444" : "#374151",
            color: "white",
            borderRadius: "8px",
            padding: "0.3rem 0.6rem",
            border: "none",
          }}
        >
          {emoji} {getCount(emoji)}
        </button>
      ))}
    </div>
  );
}

export default ReactionBox;
