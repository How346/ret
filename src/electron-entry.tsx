// Client-only entry used by the Electron/offline build (see vite.electron.config.ts).
// The web app is unaffected — it still boots through TanStack Start.
import { StrictMode, Component, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, createRouter, createMemoryHistory } from "@tanstack/react-router";
import { QueryClient } from "@tanstack/react-query";
import { routeTree } from "./routeTree.gen";
import "./styles.css";
import { applyStoredFontScale } from "@/lib/ui-preferences";

applyStoredFontScale();

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

const router = createRouter({
  routeTree,
  context: { queryClient },
  history: createMemoryHistory({ initialEntries: ["/pos"] }),
  scrollRestoration: true,
  defaultPreloadStaleTime: 0,
});

class StartupErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };

  static getDerivedStateFromError(error: unknown) {
    return { error: getSafeErrorMessage(error) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("[Margin ERP] renderer startup error", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, fontFamily: "system-ui", background: "#f8fafc" }}>
        <div style={{ width: "100%", maxWidth: 520, textAlign: "center", padding: 28, borderRadius: 16, background: "white", boxShadow: "0 12px 40px rgba(15,23,42,.10)" }}>
          <h1 style={{ margin: 0, fontSize: 22 }}>Margin ERP could not start</h1>
          <p style={{ margin: "10px 0 18px", color: "#64748b", wordBreak: "break-word" }}>{this.state.error}</p>
          <button onClick={() => window.location.reload()} style={{ border: 0, borderRadius: 10, padding: "10px 18px", background: "#172b4d", color: "white", cursor: "pointer" }}>Restart application</button>
        </div>
      </div>
    );
  }
}

function getSafeErrorMessage(error: unknown): string {
  if (error == null) return "Unknown startup error";
  if (typeof error === "string" && error.trim()) return error.trim();
  if (typeof error === "object") {
    const e = error as any;
    const candidates = [e?.message, e?.error?.message, e?.cause?.message, e?.output?.payload?.message, e?.output?.message, e?.data?.message];
    const found = candidates.find((v) => v != null && String(v).trim());
    if (found) return String(found);
  }
  try {
    const text = String(error);
    return text !== "[object Object]" ? text : "Unknown startup error";
  } catch { return "Unknown startup error"; }
}

window.addEventListener("error", (event) => console.error("[Margin ERP] window error", event.error ?? event.message));
window.addEventListener("unhandledrejection", (event) => console.error("[Margin ERP] unhandled rejection", event.reason));

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Margin ERP root element is missing.");

createRoot(rootElement).render(
  <StrictMode>
    <StartupErrorBoundary>
      <RouterProvider router={router} />
    </StartupErrorBoundary>
  </StrictMode>,
);

