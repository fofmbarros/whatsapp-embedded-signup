import { defineConfig } from "vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { mockBackend } from "./mock-backend";

export default defineConfig({
  plugins: [basicSsl(), mockBackend()],
  server: {
    https: {},
    host: "localhost",
    port: 3000,
    strictPort: true,
  },
  resolve: { dedupe: ["react", "react-dom"] },
});
