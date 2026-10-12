import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// Dev server proxies the API/SSE to the Node runtime (`npm run serve`), which
// owns the embedded database. In production the Node runtime serves dist/.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://127.0.0.1:4317", changeOrigin: true },
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
