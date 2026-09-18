import { ownerContext } from "@/server/runtime";
import { ownerList } from "@/server/owner";
import {
  checkIntent,
  checkWrite,
  endpoint,
  json,
  readJson,
} from "@/server/http";
import { idempotencyKey } from "@/server/resource-store";
import { initiateUpload, uploadSchema } from "@/server/storage/uploads";
export const dynamic = "force-dynamic";
export function GET(request: Request) {
  return endpoint(async () =>
    json(
      await ownerList(
        "file",
        Object.fromEntries(new URL(request.url).searchParams),
        request,
      ),
    ),
  );
}
export function POST(request: Request) {
  return endpoint(async () => {
    const { env } = await ownerContext(request);
    checkIntent(request, env);
    await checkWrite(env);
    return json(
      await initiateUpload(
        env,
        await readJson(request, uploadSchema),
        idempotencyKey(request),
      ),
      201,
    );
  });
}
