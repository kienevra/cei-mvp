// frontend/vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: "dist",
    rollupOptions: {
      // ensure rollup explicitly looks for index.html in the frontend root
      input: "index.html",
    },
  },
  server: {
    port: 5173,
  },
});
