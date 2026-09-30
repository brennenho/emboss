import { z } from "zod";
import { ownerContext } from "@/server/runtime";
import { ownerRestore } from "@/server/owner";
import { checkIntent, endpoint, json, readJson } from "@/server/http";
import { AppError } from "@/shared/errors";
const kinds = { links: "link", pastes: "paste", files: "file" } as const;
export function POST(
  request: Request,
  context: { params: Promise<{ kind: string; id: string }> },
) {
  return endpoint("POST /api/admin/[kind]/[id]/restore", async () => {
    const { env } = await ownerContext(request);
    checkIntent(request, env);
    const { kind, id } = await context.params;
    if (!Object.hasOwn(kinds, kind))
      throw new AppError(404, "NOT_FOUND", "Not found.");
    const result = await ownerRestore(
      kinds[kind as keyof typeof kinds],
      id,
      await readJson(request, z.unknown()),
      request,
    );
    return json(result);
  });
}
