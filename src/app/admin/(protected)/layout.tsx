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
  const installationConfig = config(env);
  return (
    <AppShell
      host={new URL(installationConfig.origin).host}
      label={settings.label}
      expiresAt={new Date(session.expiresAt).toISOString()}
      readOnly={installationConfig.READ_ONLY_MODE === "true"}
    >
      {children}
    </AppShell>
  );
}
