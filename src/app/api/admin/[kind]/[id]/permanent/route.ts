import { z } from "zod";
import { ownerContext } from "@/server/runtime";
import { ownerPermanentlyDelete } from "@/server/owner";
import { checkIntent, endpoint, privateHeaders, readJson } from "@/server/http";
import { AppError } from "@/shared/errors";
const kinds = { links: "link", pastes: "paste", files: "file" } as const;
export function DELETE(
  request: Request,
  context: { params: Promise<{ kind: string; id: string }> },
) {
  return endpoint("DELETE /api/admin/[kind]/[id]/permanent", async () => {
    const { env } = await ownerContext(request);
    checkIntent(request, env);
    const { kind, id } = await context.params;
    if (!Object.hasOwn(kinds, kind))
      throw new AppError(404, "NOT_FOUND", "Not found.");
    await ownerPermanentlyDelete(
      kinds[kind as keyof typeof kinds],
      id,
      await readJson(request, z.unknown()),
      request,
    );
    return new Response(null, { status: 204, headers: privateHeaders });
  });
}
