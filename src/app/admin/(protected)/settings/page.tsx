import { pageOwner } from "@/server/runtime";
import { ownerSettings } from "@/server/owner";
import { storageUsage } from "@/server/storage/uploads";
import { config } from "@/server/config";
import { SettingsWorkspace } from "@/features/settings/settings-workspace";
export const metadata = { title: "Settings" };
export default async function Page() {
  const { env, session } = await pageOwner();
  const [settings, usage] = await Promise.all([
    ownerSettings(),
    storageUsage(env),
  ]);
  const c = config(env);
  return (
    <SettingsWorkspace
      data={settings}
      origin={c.origin}
      usage={usage!}
      ceilings={{
        upload: c.UPLOAD_MAX_BYTES,
        quota: c.STORAGE_QUOTA_BYTES,
        paste: c.PASTE_MAX_BYTES,
      }}
      readOnly={c.READ_ONLY_MODE === "true"}
      passwordCommand={
        c.APP_ENV === "development"
          ? "pnpm admin:password --local"
          : `pnpm admin:password --env ${c.APP_ENV}`
      }
      expiresAt={new Date(session.expiresAt).toISOString()}
    />
  );
}
