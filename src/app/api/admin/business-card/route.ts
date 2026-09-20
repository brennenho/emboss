import { ownerContext } from "@/server/runtime";
import {
  checkIntent,
  checkWrite,
  endpoint,
  json,
  readJson,
} from "@/server/http";
import { cardSchema } from "@/shared/configuration";
import { saveCard } from "@/server/configuration-store";
import { readCard } from "@/server/configuration-store";
export const dynamic = "force-dynamic";
export function GET(request: Request) {
  return endpoint("GET /api/admin/business-card", async () => {
    const { env } = await ownerContext(request);
    return json(await readCard(env));
  });
}
export function PATCH(request: Request) {
  return endpoint("PATCH /api/admin/business-card", async () => {
    const { env } = await ownerContext(request);
    checkIntent(request, env);
    await checkWrite(env);
    return json(await saveCard(env, await readJson(request, cardSchema)));
  });
}
