import { pageOwner } from "@/server/runtime";
import { ownerList, ownerResource, ownerSettings } from "@/server/owner";
import { config } from "@/server/config";
import { PasteWorkspace } from "@/features/pastes/paste-workspace";
export const metadata = { title: "Pastes" };
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { env } = await pageOwner();
  const query = await searchParams;
  const [page, selected, settings] = await Promise.all([
    ownerList("paste", query),
    query.item && query.item !== "new"
      ? ownerResource("paste", query.item)
      : null,
    ownerSettings(),
  ]);
  return (
    <PasteWorkspace
      page={page}
      selected={selected}
      creating={query.item === "new"}
      origin={config(env).origin}
      query={query.q ?? ""}
      state={query.state ?? "all"}
      maxBytes={Math.min(settings.pasteMaxBytes, config(env).PASTE_MAX_BYTES)}
    />
  );
}
