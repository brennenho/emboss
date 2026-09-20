import { ownerContext } from "@/server/runtime";
import {
  checkIntent,
  checkWrite,
  endpoint,
  json,
  readJson,
} from "@/server/http";
import { changeResourceState } from "@/server/resource-store";
import { resourceStateSchema } from "@/shared/resources";
import { AppError } from "@/shared/errors";
const kinds = { links: "link", pastes: "paste", files: "file" } as const;
export function PATCH(
  request: Request,
  context: { params: Promise<{ kind: string; id: string }> },
) {
  return endpoint("PATCH /api/admin/[kind]/[id]/state", async () => {
    const { env } = await ownerContext(request);
    checkIntent(request, env);
    await checkWrite(env);
    const { kind, id } = await context.params;
    if (!Object.hasOwn(kinds, kind))
      throw new AppError(404, "NOT_FOUND", "Not found.");
    return json(
      await changeResourceState(
        env,
        kinds[kind as keyof typeof kinds],
        id,
        await readJson(request, resourceStateSchema),
      ),
    );
  });
}
