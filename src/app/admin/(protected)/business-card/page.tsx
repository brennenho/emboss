import { pageOwner } from "@/server/runtime";
import { readCard, readScheduling } from "@/server/configuration-store";
import { ownerSettings } from "@/server/owner";
import { config } from "@/server/config";
import { CardWorkspace } from "@/features/card/card-workspace";
export default async function Page() {
  const { env } = await pageOwner();
  const [card, scheduling, settings] = await Promise.all([
    readCard(env),
    readScheduling(env),
    ownerSettings(),
  ]);
  return (
    <CardWorkspace
      key={card.revision}
      data={card}
      origin={config(env).origin}
      schedulingEnabled={scheduling.enabled}
      maxAvatarBytes={Math.min(
        2 * 1024 ** 2,
        config(env).UPLOAD_MAX_BYTES,
        settings.uploadMaxBytes,
      )}
    />
  );
}
