import { pageOwner } from "@/server/runtime";
import { ownerSettings } from "@/server/owner";
import { config } from "@/server/config";
import { AppShell } from "@/components/shell/app-shell";
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { env, session } = await pageOwner();
  const settings = await ownerSettings();
  return (
    <AppShell
      host={new URL(config(env).origin).host}
      label={settings.label}
      expiresAt={new Date(session.expiresAt).toISOString()}
    >
      {children}
    </AppShell>
  );
}
