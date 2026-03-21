import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return null;
          }

          if (
            id.includes("@tensorflow-models/face-landmarks-detection") ||
            id.includes("@tensorflow-models/face-detection") ||
            id.includes("@mediapipe")
          ) {
            return "face-model-vendor";
          }

          if (id.includes("@tensorflow/tfjs")) {
            return "tfjs-vendor";
          }

          if (id.includes("framer-motion")) {
            return "motion-vendor";
          }

          if (id.includes("socket.io-client")) {
            return "socket-vendor";
          }

          return "vendor";
        }
      }
    }
  },
  server: {
    port: 5173
  }
});
