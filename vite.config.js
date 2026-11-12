import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { createClaudeMiddleware } from "./claude-server.js";

export default defineConfig({
  plugins: [react(), tailwindcss(), {
    name: "claude-local-api",
    configureServer(server) {
      server.middlewares.use(createClaudeMiddleware({ root: server.config.root }));
    },
  }],
  server: {
    host: "127.0.0.1",
    port: 3001,
    strictPort: false,
  },
});