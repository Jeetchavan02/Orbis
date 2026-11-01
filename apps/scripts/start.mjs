// Production entry point: one process serves the web app, the REST API and the collaboration WebSocket.
//   npm run build && npm start
// Hosts set PORT; set RB_DATA_DIR to a persistent volume so projects survive redeploys.
process.env.NODE_ENV ??= "production";
await import("../server/dist/index.js");
