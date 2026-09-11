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

function ErrorComponent({ error, reset }: { error: Error | unknown; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  const safeMessage = error instanceof Error ? error.message : String((error as any)?.message ?? error ?? "Unknown application error");
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted-foreground">{safeMessage}</p>
        <button
          onClick={() => { router.invalidate(); reset(); }}
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
