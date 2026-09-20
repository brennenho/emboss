import { ownerContext } from "@/server/runtime";
import {
  checkIntent,
  checkWrite,
  endpoint,
  json,
  readJson,
} from "@/server/http";
import { initiateUpload, uploadSchema } from "@/server/storage/uploads";
import { idempotencyKey } from "@/server/resource-store";
export function POST(request: Request) {
  return endpoint("POST /api/admin/business-card/avatar", async () => {
    const { env } = await ownerContext(request);
    checkIntent(request, env);
    await checkWrite(env);
    const input = await readJson(request, uploadSchema.omit({ slug: true }));
    return json(
      await initiateUpload(env, input, idempotencyKey(request), "avatar"),
      201,
    );
  });
}
