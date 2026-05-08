# Mate — Socket.IO chess server

Realtime backend for the Mate chess frontend. Authoritative game state,
move validation with chess.js, room lifecycle, reconnects.

## Deploy

### Railway / Render / Fly
1. Push this folder as its own service.
2. Set env (optional): `CORS_ORIGIN=https://your-frontend.com`
3. Start command: `npm start`. Port is read from `$PORT` (default 3001).
4. Copy the public URL (e.g. `https://mate-chess.up.railway.app`).

### Wire to the frontend
On the Lovable project, add an env var:

```
VITE_SOCKET_URL=https://mate-chess.up.railway.app
```

Redeploy the frontend. Online play will be live.

## Local development

```
cd server
npm install
npm run dev
```

Server runs on `http://localhost:3001`. Set `VITE_SOCKET_URL=http://localhost:3001`
when developing the frontend locally.

## Events

Client → Server: `room:join`, `game:move`, `game:resign`, `game:draw-offer`,
`game:draw-accept`, `game:rematch`.

Server → Client: `room:joined`, `room:state`, `game:move`, `game:resign`,
`game:draw-offer`, `game:draw-accept`, `game:rematch`, `room:error`.
