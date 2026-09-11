import { Link, useRouterState } from "@tanstack/react-router";
import {
  ScanBarcode, LayoutDashboard, Package, Users, ReceiptText,
  ShoppingCart, BarChart3, Settings, Truck, BookOpen, ShieldCheck,
} from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar, SidebarHeader, SidebarFooter,
} from "@/components/ui/sidebar";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";

type Item = { title: string; url: string; icon: any; hint?: string };
type Group = { label: string; items: Item[]; adminOnly?: boolean };

const groups: Group[] = [
  {
    label: "Operations",
    items: [
      { title: "POS / Billing", url: "/pos", icon: ScanBarcode, hint: "F2" },
      { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
      { title: "Sales", url: "/sales", icon: ReceiptText },
    ],
  },
  {
    label: "Inventory",
    items: [
      { title: "Products", url: "/products", icon: Package },
      { title: "Categories", url: "/categories", icon: BookOpen },
      { title: "Purchases", url: "/purchases", icon: ShoppingCart },
      { title: "Suppliers", url: "/suppliers", icon: Truck },
    ],
  },
  {
    label: "People & Reports",
    items: [
      { title: "Customers", url: "/customers", icon: Users },
      { title: "Reports", url: "/reports", icon: BarChart3 },
      { title: "Settings", url: "/settings", icon: Settings },
    ],
  },
  {
    label: "Admin",
    adminOnly: true,
    items: [{ title: "Admin Panel", url: "/admin", icon: ShieldCheck }],
  },
];



export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const path = useRouterState({ select: (r) => r.location.pathname });
  const { user, role, signOut } = useAuth();
  const isActive = (url: string) => path === url || path.startsWith(url + "/");

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border">
        <Link to="/pos" className="flex items-center gap-2 px-2 py-2">
          <div className="h-8 w-8 rounded-md bg-sidebar-primary text-sidebar-primary-foreground grid place-items-center font-display font-bold">
            M
          </div>
          {!collapsed && (
            <div className="flex flex-col leading-tight">
              <span className="font-display font-bold text-sidebar-foreground text-sm">Margin ERP</span>
              <span className="text-[10px] text-sidebar-foreground/60 uppercase tracking-wider">Retail · POS · GST</span>
            </div>
          )}
        </Link>
      </SidebarHeader>

      <SidebarContent>
        {groups.filter(g => !g.adminOnly || role === "admin").map((g) => (
          <SidebarGroup key={g.label}>
            {!collapsed && <SidebarGroupLabel>{g.label}</SidebarGroupLabel>}
            <SidebarGroupContent>
              <SidebarMenu>
                {g.items.map((item) => (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={item.title}>
                      <Link to={item.url} className="flex items-center gap-2">
                        <item.icon className="h-4 w-4 shrink-0" />
                        {!collapsed && (
                          <>
                            <span className="flex-1">{item.title}</span>
                            {item.hint && <span className="kbd">{item.hint}</span>}
                          </>
                        )}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        {!collapsed ? (
          <div className="flex items-center justify-between gap-2 p-2">
            <div className="flex flex-col leading-tight min-w-0">
              <span className="text-xs font-medium text-sidebar-foreground truncate">{user?.email}</span>
              <span className="text-[10px] uppercase tracking-wider text-sidebar-foreground/60">{role}</span>
            </div>
            <Button size="icon" variant="ghost" className="text-sidebar-foreground hover:bg-sidebar-accent" onClick={signOut}>
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <Button size="icon" variant="ghost" className="text-sidebar-foreground hover:bg-sidebar-accent w-full" onClick={signOut}>
            <LogOut className="h-4 w-4" />
          </Button>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
