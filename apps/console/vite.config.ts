import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const DAEMON_TARGET = process.env.AI0_DAEMON_URL ?? "http://127.0.0.1:4174";
const CONSOLE_PORT = Number(process.env.AI0_PORT ?? 4173);

export default defineConfig({
  plugins: [react()],
  resolve: {
    conditions: ["development"]
  },
  server: {
    host: "127.0.0.1",
    port: CONSOLE_PORT,
    strictPort: false,
    proxy: {
      "/api": {
        target: DAEMON_TARGET,
        changeOrigin: true
      },
      "/protocol": {
        target: DAEMON_TARGET,
        changeOrigin: true
      },
      "/healthz": {
        target: DAEMON_TARGET,
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: "dist/client",
    emptyOutDir: true
  }
});
