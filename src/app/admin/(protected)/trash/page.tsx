import { pageOwner } from "@/server/runtime";
import { ownerTrash } from "@/server/owner";
import { config } from "@/server/config";
import { TrashWorkspace } from "@/features/trash/trash-workspace";

export const metadata = { title: "Trash" };
export default async function TrashPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { env } = await pageOwner();
  const query = await searchParams;
  const page = await ownerTrash(query);
  return (
    <TrashWorkspace
      key={query.q ?? ""}
      page={page}
      query={query.q ?? ""}
      readOnly={config(env).READ_ONLY_MODE === "true"}
    />
  );
}
