import { ownerContext } from "@/server/runtime";
import {
  checkIntent,
  checkWrite,
  endpoint,
  json,
  readJson,
} from "@/server/http";
import { settingsSchema } from "@/shared/configuration";
import { saveSettings } from "@/server/configuration-store";
import { ownerSettings } from "@/server/owner";
export const dynamic = "force-dynamic";
export function GET(request: Request) {
  return endpoint("GET /api/admin/settings", async () => {
    await ownerContext(request);
    return json(await ownerSettings(request));
  });
}
export function PATCH(request: Request) {
  return endpoint("PATCH /api/admin/settings", async () => {
    const { env } = await ownerContext(request);
    checkIntent(request, env);
    await checkWrite(env);
    return json(
      await saveSettings(env, await readJson(request, settingsSchema)),
    );
  });
}
