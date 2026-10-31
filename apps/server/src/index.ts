import { createServer } from "node:http";
import express from "express";
import { WebSocketServer } from "ws";
import { ApiHealthSchema } from "@reality-builder/shared";

const app = express();
const server = createServer(app);
const websocketServer = new WebSocketServer({ server, path: "/ws" });

app.get("/api/health", (_request, response) => {
  const health = ApiHealthSchema.parse({
    status: "ok",
    service: "reality-builder-api",
    timestamp: new Date().toISOString(),
  });

  response.status(200).json(health);
});

websocketServer.on("connection", (socket) => {
  socket.send(JSON.stringify({
    type: "server.ready",
    payload: {
      status: "scaffold",
      message: "Realtime collaboration protocol is not implemented yet.",
    },
  }));
});

const port = Number(process.env.PORT ?? 3001);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535.");
}

server.listen(port, "127.0.0.1", () => {
  console.log("Reality Builder API listening at http://127.0.0.1:" + port);
});

function shutdown() {
  websocketServer.close();
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
