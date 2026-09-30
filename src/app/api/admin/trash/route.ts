import { ownerTrash } from "@/server/owner";
import { endpoint, json } from "@/server/http";
export const dynamic = "force-dynamic";
export function GET(request: Request) {
  return endpoint("GET /api/admin/trash", async () =>
    json(
      await ownerTrash(
        Object.fromEntries(new URL(request.url).searchParams),
        request,
      ),
    ),
  );
}
