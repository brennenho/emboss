import { ownerContext } from "@/server/runtime";
import {
  checkIntent,
  checkWrite,
  endpoint,
  json,
  readJson,
} from "@/server/http";
import { schedulingSchema } from "@/shared/configuration";
import { saveScheduling } from "@/server/configuration-store";
import { readScheduling } from "@/server/configuration-store";
export const dynamic = "force-dynamic";
export function GET(request: Request) {
  return endpoint(async () => {
    const { env } = await ownerContext(request);
    return json(await readScheduling(env));
  });
}
export function PATCH(request: Request) {
  return endpoint(async () => {
    const { env } = await ownerContext(request);
    checkIntent(request, env);
    await checkWrite(env);
    return json(
      await saveScheduling(env, await readJson(request, schedulingSchema)),
    );
  });
}
