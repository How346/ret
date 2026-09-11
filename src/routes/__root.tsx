import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet, createRootRouteWithContext, useRouter,
  HeadContent, Scripts, Link,
} from "@tanstack/react-router";
import appCss from "../styles.css?url";
import { AuthProvider } from "@/hooks/use-auth";
import { Toaster } from "@/components/ui/sonner";
import { useBodyPointerEventsFix } from "@/lib/use-body-pointer-events-fix";

const IS_DESKTOP = import.meta.env.VITE_DESKTOP === "true";



function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-display font-bold text-foreground">404</h1>
        <p className="mt-2 text-sm text-muted-foreground">Page not found.</p>
        <Link to="/pos" className="mt-6 inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Go to POS</Link>
      </div>
    </div>
  );
}

function safeErrorMessage(error: unknown): string {
  if (error == null) return "The application encountered an unknown startup error.";
  if (typeof error === "string" && error.trim()) return error.trim();
  if (typeof error === "object") {
    const e = error as any;
    const candidates = [
      e?.message,
      e?.error?.message,
      e?.cause?.message,
      e?.output?.payload?.message,
      e?.output?.message,
      e?.data?.message,
    ];
    const value = candidates.find((v) => v != null && String(v).trim());
    if (value) return String(value);
  }
  try {
    const text = String(error);
    return text && text !== "[object Object]" ? text : "The application encountered an unknown startup error.";
  } catch {
    return "The application encountered an unknown startup error.";
  }
}

function ErrorComponent({ error, reset }: { error: unknown; reset: () => void }) {
  const router = useRouter();
  const message = safeErrorMessage(error);
  console.error("[Margin ERP] route error:", error);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted-foreground break-words">{message}</p>
        <button
          onClick={() => {
            try { router.invalidate(); } catch {}
            try { reset(); } catch {}
          }}
          className="mt-6 inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >Try again</button>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Margin ERP — Billing, Inventory & GST POS" },
      { name: "description", content: "Fast, keyboard-first retail billing with inventory, GST invoicing, customers and reports." },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: IS_DESKTOP ? DesktopShell : RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

// The desktop (Electron) build mounts into an existing <div id="root">, so it
// must NOT render its own <html>/<head>/<body> document shell.
function DesktopShell({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head><HeadContent /></head>
      <body>{children}<Scripts /></body>
    </html>
  );
}


function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  useBodyPointerEventsFix();
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Outlet />
        <Toaster richColors position="top-right" />
      </AuthProvider>
    </QueryClientProvider>
  );
}
