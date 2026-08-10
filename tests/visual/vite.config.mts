import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  root: path.resolve(__dirname),
  publicDir: path.resolve(__dirname, "../../assets"),
  server: {
    fs: {
      allow: [path.resolve(__dirname, "../..")]
    }
  }
});
