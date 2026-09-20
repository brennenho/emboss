import { ownerContext } from "@/server/runtime";
import {
  checkIntent,
  checkWrite,
  endpoint,
  json,
  readJson,
} from "@/server/http";
import { unpublishCard } from "@/server/configuration-store";
import { revisionSchema } from "@/shared/resources";
export function PATCH(request: Request) {
  return endpoint("PATCH /api/admin/business-card/unpublish", async () => {
    const { env } = await ownerContext(request);
    checkIntent(request, env);
    await checkWrite(env);
    const input = await readJson(request, revisionSchema);
    return json(await unpublishCard(env, input.expectedRevision));
  });
}
