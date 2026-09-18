"use client";
import { LocalTime } from "@/components/patterns/local-time";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Link2,
  FileCode2,
  Folder,
  CalendarDays,
  Contact,
  Settings2,
  KeyRound,
  ChevronUp,
  LogOut,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  NavigationGuard,
  useNavigationGuard,
} from "@/components/patterns/navigation-guard";
import { api } from "@/shared/client-api";
const tools = [
  ["links", "Links", Link2],
  ["pastes", "Pastes", FileCode2],
  ["files", "Files", Folder],
  ["scheduling", "Scheduling", CalendarDays],
  ["business-card", "Business card", Contact],
] as const;
function Navigation({
  host,
  label,
  expiresAt,
}: {
  host: string;
  label: string;
  expiresAt: string;
}) {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();
  const go = useNavigationGuard();
  const [error, setError] = useState(""),
    [pending, setPending] = useState(false);
  return (
    <Sidebar collapsible="offcanvas">
      <SidebarHeader className="px-6 pt-8 pb-7">
        <div className="wordmark">
          <span className="mark" aria-hidden="true" />
          EMBOSS
        </div>
        <p className="text-muted-foreground mt-3 font-mono text-xs break-all">
          {host}
        </p>
        {label !== "Emboss" && <p className="muted">{label}</p>}
      </SidebarHeader>
      <SidebarContent className="px-3">
        <SidebarMenu>
          {tools.map(([path, name, Icon]) => (
            <SidebarMenuItem key={path}>
              <SidebarMenuButton
                asChild
                isActive={pathname === `/admin/${path}`}
              >
                <Link
                  href={`/admin/${path}`}
                  onClick={() => setOpenMobile(false)}
                >
                  <Icon />
                  <span>{name}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarContent>
      <SidebarFooter className="gap-3 px-3 pb-5">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={pathname === "/admin/settings"}
            >
              <Link href="/admin/settings" onClick={() => setOpenMobile(false)}>
                <Settings2 />
                <span>Settings</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <div className="border-border border-t pt-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton>
                <KeyRound />
                <span>Admin session</span>
                <ChevronUp className="ml-auto" />
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="w-64">
              <DropdownMenuLabel>Admin session</DropdownMenuLabel>
              <p className="text-muted-foreground px-2 py-1 text-xs">
                Expires <LocalTime value={expiresAt} />
              </p>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={pending}
                onSelect={(event) => {
                  event.preventDefault();
                  go(() => {
                    setPending(true);
                    void api("/api/auth/logout", "POST", {})
                      .then(() => window.location.replace("/admin/login"))
                      .catch(() => {
                        setError("Could not sign out. Try again.");
                        setPending(false);
                      });
                  });
                }}
              >
                <LogOut />
                {pending ? "Signing out…" : "Sign out"}
              </DropdownMenuItem>
              {error && (
                <p role="alert" className="text-destructive px-2 text-xs">
                  {error}
                </p>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
export function AppShell({
  children,
  host,
  label,
  expiresAt,
}: {
  children: React.ReactNode;
  host: string;
  label: string;
  expiresAt: string;
}) {
  useEffect(() => {
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) window.location.reload();
    };
    window.addEventListener("pageshow", restore);
    return () => window.removeEventListener("pageshow", restore);
  }, []);
  return (
    <NavigationGuard>
      <SidebarProvider open={true} onOpenChange={() => {}}>
        <Navigation host={host} label={label} expiresAt={expiresAt} />
        <SidebarInset className="min-w-0">
          <div className="flex items-center gap-3 border-b p-3 md:hidden">
            <SidebarTrigger aria-label="Open navigation" />
            <span className="font-mono text-xs">{host}</span>
          </div>
          {children}
        </SidebarInset>
      </SidebarProvider>
    </NavigationGuard>
  );
}
