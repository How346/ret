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
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    outDir: path.resolve(__dirname, "dist-electron"),
    emptyOutDir: true,
    target: "chrome120",
  },
});
