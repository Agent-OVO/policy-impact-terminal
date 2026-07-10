import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

function getManualChunk(id: string) {
  const normalizedId = id.replace(/\\/g, "/");
  if (!normalizedId.includes("/node_modules/")) return undefined;
  if (normalizedId.includes("/node_modules/lucide-react/")) return "vendor-icons";
  if (
    normalizedId.includes("/node_modules/react/") ||
    normalizedId.includes("/node_modules/react-dom/") ||
    normalizedId.includes("/node_modules/scheduler/")
  ) {
    return "vendor-react";
  }
  if (
    normalizedId.includes("/node_modules/@supabase/") ||
    normalizedId.includes("/node_modules/iceberg-js/") ||
    normalizedId.includes("/node_modules/tslib/")
  ) {
    return "vendor-supabase";
  }
  return "vendor";
}

export default defineConfig({
  base: process.env.VITE_BASE_PATH || "/",
  plugins: [react()],
  build: {
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: getManualChunk
      }
    }
  },
  server: {
    port: 5174
  }
});
