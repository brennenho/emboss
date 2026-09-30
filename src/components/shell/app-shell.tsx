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
  X,
  Trash2,
  LockKeyhole,
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
import { Brand } from "./brand";
import { Button } from "@/components/ui/button";
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
      <SidebarHeader className="brand-header px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <Brand />
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-label="Close navigation"
            onClick={() => setOpenMobile(false)}
          >
            <X />
          </Button>
        </div>
        <p className="brand-host" title={host}>
          {host}
        </p>
        {label !== "Emboss" && <p className="muted">{label}</p>}
      </SidebarHeader>
      <SidebarContent className="px-3 py-5">
        <nav aria-label="Tools">
          <SidebarMenu>
            {tools.map(([path, name, Icon]) => (
              <SidebarMenuItem key={path}>
                <SidebarMenuButton
                  asChild
                  isActive={pathname === `/admin/${path}`}
                >
                  <Link
                    href={`/admin/${path}`}
                    aria-current={
                      pathname === `/admin/${path}` ? "page" : undefined
                    }
                    onClick={() => setOpenMobile(false)}
                  >
                    <Icon />
                    <span>{name}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </nav>
      </SidebarContent>
      <SidebarFooter className="gap-3 px-3 pb-5">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={pathname === "/admin/trash"}>
              <Link
                href="/admin/trash"
                aria-current={pathname === "/admin/trash" ? "page" : undefined}
                onClick={() => setOpenMobile(false)}
              >
                <Trash2 />
                <span>Trash</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={pathname === "/admin/settings"}
            >
              <Link
                href="/admin/settings"
                aria-current={
                  pathname === "/admin/settings" ? "page" : undefined
                }
                onClick={() => setOpenMobile(false)}
              >
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
  readOnly = false,
}: {
  children: React.ReactNode;
  host: string;
  label: string;
  expiresAt: string;
  readOnly?: boolean;
}) {
  useEffect(() => {
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) window.location.reload();
    };
    window.addEventListener("pageshow", restore);
    return () => window.removeEventListener("pageshow", restore);
  }, []);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => {
      const editing = document.activeElement?.matches(
        "input, textarea, [contenteditable='true']",
      );
      const keyboardOpen =
        editing && window.innerHeight - viewport.height > 120;
      document.documentElement.toggleAttribute(
        "data-keyboard-open",
        !!keyboardOpen,
      );
    };
    viewport.addEventListener("resize", update);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    return () => {
      viewport.removeEventListener("resize", update);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
      document.documentElement.removeAttribute("data-keyboard-open");
    };
  }, []);
  return (
    <NavigationGuard>
      <a className="skip-link" href="#workspace">
        Skip to workspace
      </a>
      <SidebarProvider open={true} onOpenChange={() => {}}>
        <Navigation host={host} label={label} expiresAt={expiresAt} />
        <SidebarInset className="min-w-0" id="workspace" tabIndex={-1}>
          <div className="mobile-bar md:hidden">
            <SidebarTrigger aria-label="Open navigation" />
            <Brand compact />
            <span className="brand-host" title={host}>
              {host}
            </span>
          </div>
          {readOnly && (
            <div role="status" className="maintenance-banner">
              <LockKeyhole size={16} aria-hidden="true" />
              <p>
                <strong>Changes paused for maintenance.</strong> You can still
                browse, copy links, and download files.
              </p>
            </div>
          )}
          {children}
        </SidebarInset>
      </SidebarProvider>
    </NavigationGuard>
  );
}
