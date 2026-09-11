// Desktop (Electron) build ONLY. The online app keeps using vite.config.ts.
// This produces a plain client-side SPA in dist-electron/ where every
// `@/integrations/supabase/client` import is aliased to the local offline
// database, so the packaged .exe needs no internet at all.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import path from "node:path";

export default defineConfig({
  base: "./",
  root: path.resolve(__dirname, "electron"),
  plugins: [tsConfigPaths({ projects: ["./tsconfig.json"] }), tailwindcss(), react()],
  resolve: {
    alias: [
      {
        find: /^@\/integrations\/supabase\/client$/,
        replacement: path.resolve(__dirname, "src/lib/offline/client.ts"),
      },
      { find: "@", replacement: path.resolve(__dirname, "src") },
    ],
    dedupe: ["react", "react-dom", "@tanstack/react-router", "@tanstack/react-query"],
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
    "import.meta.env.VITE_DESKTOP": JSON.stringify("true"),
  },

  build: {
    outDir: path.resolve(__dirname, "dist-electron"),
    emptyOutDir: true,
    target: "chrome120",
    // Splits the big third-party libraries into their own chunks instead of
    // one giant bundle — this is purely a load-time/organization
    // improvement (the "chunk larger than 500kB" warning), it doesn't
    // change what code runs.
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (/[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return "vendor-react";
          if (/[\\/]@tanstack[\\/]/.test(id)) return "vendor-tanstack";
          if (/[\\/](recharts|d3-[a-z-]+)[\\/]/.test(id)) return "vendor-charts";
          if (/[\\/](jsbarcode|html2canvas|qrcode)[\\/]/.test(id)) return "vendor-media";
          if (/[\\/]@radix-ui[\\/]/.test(id)) return "vendor-radix";
          if (/[\\/]lucide-react[\\/]/.test(id)) return "vendor-icons";
          return "vendor";
        },
      },
    },
  },
});
