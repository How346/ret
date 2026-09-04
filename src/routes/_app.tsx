import { createFileRoute, Outlet, Navigate } from "@tanstack/react-router";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { useAuth } from "@/hooks/use-auth";
import { LicenseGate } from "@/components/license-gate";

export const Route = createFileRoute("/_app")({
  component: AppLayout,
});

function AppLayout() {
  const { session, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center bg-background text-muted-foreground">
        Loading…
      </div>
    );
  }
  if (!session) return <Navigate to="/login" />;

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-12 flex items-center gap-2 border-b border-border px-3 bg-card/40 backdrop-blur sticky top-0 z-10">
            <SidebarTrigger />
            <div className="flex-1" />
            <ThemeToggle />
          </header>
          <main className="flex-1 min-w-0 overflow-hidden">
            <LicenseGate>
              <Outlet />
            </LicenseGate>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

