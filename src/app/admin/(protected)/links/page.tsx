import { pageOwner } from "@/server/runtime";
import { ownerList, ownerResource } from "@/server/owner";
import { config } from "@/server/config";
import { LinkWorkspace } from "@/features/links/link-workspace";
export default async function LinksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { env } = await pageOwner();
  const query = await searchParams;
  const page = await ownerList("link", query);
  const selected =
    query.item && query.item !== "new"
      ? await ownerResource("link", query.item)
      : null;
  return (
    <LinkWorkspace
      page={page}
      selected={selected}
      creating={query.item === "new"}
      origin={config(env).origin}
      query={query.q ?? ""}
      state={query.state ?? "all"}
    />
  );
}
