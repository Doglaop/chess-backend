// Minimal, production-ready Socket.IO server for Mate chess.
// Deploy on Railway / Render / Fly / any Node host.
//
//   npm install
//   npm start
//
// Env:
//   PORT=3001 (default)
//   CORS_ORIGIN=*  (or your frontend URL)

import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { Chess } from "chess.js";

const PORT = Number(process.env.PORT || 3001);
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";

const app = express();
app.get("/", (_req, res) => res.json({ ok: true, service: "mate-chess" }));
app.get("/health", (_req, res) => res.send("ok"));

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: CORS_ORIGIN, methods: ["GET", "POST"] },
  pingInterval: 20000,
  pingTimeout: 25000,
});

/**
 * @typedef {{ id: string, name: string }} Player
 * @typedef {{
 *   chess: Chess,
 *   white: Player|null,
 *   black: Player|null,
 *   spectators: Set<string>,
 *   timeMode: "blitz"|"rapid"|"unlimited",
 *   whiteMs: number,
 *   blackMs: number,
 *   lastTickAt: number|null,
 *   status: "waiting"|"playing"|"ended",
 * }} Room
 */

/** @type {Map<string, Room>} */
const rooms = new Map();

const TIME_PRESETS = { blitz: 5 * 60_000, rapid: 10 * 60_000, unlimited: 0 };

function getRoom(roomId) {
  let r = rooms.get(roomId);
  if (!r) {
    r = {
      chess: new Chess(),
      white: null, black: null,
      spectators: new Set(),
      timeMode: "rapid",
      whiteMs: TIME_PRESETS.rapid,
      blackMs: TIME_PRESETS.rapid,
      lastTickAt: null,
      status: "waiting",
    };
    rooms.set(roomId, r);
  }
  return r;
}

function publicState(r) {
  return {
    fen: r.chess.fen(),
    white: r.white,
    black: r.black,
    timeMode: r.timeMode,
    whiteMs: r.whiteMs,
    blackMs: r.blackMs,
    status: r.status,
  };
}

function broadcastState(roomId) {
  const r = rooms.get(roomId);
  if (!r) return;
  io.to(roomId).emit("room:state", publicState(r));
}

io.on("connection", (socket) => {
  let joinedRoom = null;
  let myColor = null;

  socket.on("room:join", ({ roomId, name }) => {
    if (typeof roomId !== "string" || !roomId.match(/^[a-zA-Z0-9]{3,32}$/)) {
      socket.emit("room:error", { message: "Invalid room id" });
      return;
    }
    const safeName = String(name || "Guest").slice(0, 24) || "Guest";
    const r = getRoom(roomId);

    let color = null;
    if (!r.white) { r.white = { id: socket.id, name: safeName }; color = "w"; }
    else if (!r.black) { r.black = { id: socket.id, name: safeName }; color = "b"; }
    else { r.spectators.add(socket.id); color = null; }

    socket.join(roomId);
    joinedRoom = roomId;
    myColor = color;

    if (r.white && r.black && r.status === "waiting") {
      r.status = "playing";
      r.lastTickAt = Date.now();
    }

    socket.emit("room:joined", { color, state: publicState(r) });
    broadcastState(roomId);
  });

  socket.on("game:move", ({ roomId, from, to, promotion }) => {
    const r = rooms.get(roomId);
    if (!r || r.status !== "playing") return;
    const color = r.chess.turn();
    const expectedId = color === "w" ? r.white?.id : r.black?.id;
    if (socket.id !== expectedId) {
      socket.emit("room:error", { message: "Not your turn" });
      return;
    }
    let move;
    try { move = r.chess.move({ from, to, promotion: promotion || "q" }); }
    catch { move = null; }
    if (!move) { socket.emit("room:error", { message: "Illegal move" }); return; }

    // Update clocks
    if (r.timeMode !== "unlimited" && r.lastTickAt) {
      const now = Date.now();
      const delta = now - r.lastTickAt;
      if (color === "w") r.whiteMs = Math.max(0, r.whiteMs - delta);
      else r.blackMs = Math.max(0, r.blackMs - delta);
      r.lastTickAt = now;
    }

    io.to(roomId).emit("game:move", { from, to, promotion, by: socket.id });

    if (r.chess.isGameOver()) { r.status = "ended"; r.lastTickAt = null; }
    broadcastState(roomId);
  });

  socket.on("game:resign", ({ roomId, color }) => {
    const r = rooms.get(roomId);
    if (!r) return;
    r.status = "ended"; r.lastTickAt = null;
    io.to(roomId).emit("game:resign", { color });
    broadcastState(roomId);
  });

  socket.on("game:draw-offer", ({ roomId, color }) => {
    socket.to(roomId).emit("game:draw-offer", { color });
  });
  socket.on("game:draw-accept", ({ roomId }) => {
    const r = rooms.get(roomId);
    if (!r) return;
    r.status = "ended"; r.lastTickAt = null;
    io.to(roomId).emit("game:draw-accept", {});
    broadcastState(roomId);
  });

  socket.on("game:rematch", ({ roomId }) => {
    const r = rooms.get(roomId);
    if (!r) return;
    // Swap colors for fairness
    const w = r.white, b = r.black;
    r.white = b; r.black = w;
    r.chess = new Chess();
    r.whiteMs = TIME_PRESETS[r.timeMode];
    r.blackMs = TIME_PRESETS[r.timeMode];
    r.lastTickAt = r.timeMode === "unlimited" ? null : Date.now();
    r.status = r.white && r.black ? "playing" : "waiting";
    io.to(roomId).emit("game:rematch", {});
    broadcastState(roomId);
  });

  socket.on("disconnect", () => {
    if (!joinedRoom) return;
    const r = rooms.get(joinedRoom);
    if (!r) return;
    if (r.white?.id === socket.id) r.white = null;
    else if (r.black?.id === socket.id) r.black = null;
    else r.spectators.delete(socket.id);

    // Clean up empty rooms after 60s of nobody
    setTimeout(() => {
      const cur = rooms.get(joinedRoom);
      if (cur && !cur.white && !cur.black && cur.spectators.size === 0) {
        rooms.delete(joinedRoom);
      }
    }, 60_000);

    broadcastState(joinedRoom);
  });
});

httpServer.listen(PORT, () => {
  console.log(`mate-chess server listening on :${PORT}`);
});
