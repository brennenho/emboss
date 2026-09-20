import { pageOwner } from "@/server/runtime";
import { ownerList, ownerResource, ownerSettings } from "@/server/owner";
import { config } from "@/server/config";
import { FileWorkspace } from "@/features/files/file-workspace";
export const metadata = { title: "Files" };
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { env } = await pageOwner();
  const query = await searchParams;
  const [page, selected, settings] = await Promise.all([
    ownerList("file", query),
    query.item ? ownerResource("file", query.item) : null,
    ownerSettings(),
  ]);
  return (
    <FileWorkspace
      page={page}
      selected={selected}
      query={query.q ?? ""}
      state={query.state ?? "all"}
      maxBytes={Math.min(settings.uploadMaxBytes, config(env).UPLOAD_MAX_BYTES)}
    />
  );
}
