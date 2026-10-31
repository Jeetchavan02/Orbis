import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // 127.0.0.1 by default; `npm run dev:share` sets RB_HOST=0.0.0.0 so people on the same network can join.
    host: process.env.RB_HOST ?? "127.0.0.1",
    proxy: {
      "/api": "http://127.0.0.1:3001",
      "/ws": {
        target: "ws://127.0.0.1:3001",
        ws: true,
      },
    },
  },
});
