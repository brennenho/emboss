import { notFound } from "next/navigation";
import { bindings } from "@/server/runtime";
import { publicCard, readScheduling } from "@/server/configuration-store";
import { config } from "@/server/config";
import { BusinessCardView } from "@/features/card/business-card-view";
import { ShareDialog } from "@/components/sharing/share-dialog";
export const dynamic = "force-dynamic";
export default async function Page() {
  const env = bindings();
  const card = await publicCard(env);
  if (!card) notFound();
  const scheduling = await readScheduling(env);
  return (
    <main className="public-page max-w-xl">
      <BusinessCardView card={card} schedulingEnabled={scheduling.enabled} />
      <div className="mt-5 flex justify-center">
        <ShareDialog
          url={config(env).origin + "/contact"}
          title={card.displayName}
          state="active"
        />
      </div>
    </main>
  );
}
