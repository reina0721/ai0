import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  define: {
    "process.env.NODE_ENV": JSON.stringify("production")
  },
  build: {
    outDir: "dist/ui",
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: {
      entry: "src/stage/stage-entry.tsx",
      formats: ["es"],
      fileName: () => "stage.js",
      cssFileName: "stage"
    }
  }
});
