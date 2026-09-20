import { ownerContext } from "@/server/runtime";
import { checkIntent, checkWrite, endpoint, json } from "@/server/http";
import {
  transferUpload,
  cancelUpload,
  uploadResult,
} from "@/server/storage/uploads";
type Context = { params: Promise<{ id: string }> };
export function PUT(request: Request, context: Context) {
  return endpoint("PUT /api/admin/uploads/[id]", async () => {
    const { env } = await ownerContext(request);
    checkIntent(request, env, "application/octet-stream");
    await checkWrite(env);
    return json(await transferUpload(env, (await context.params).id, request));
  });
}
export function DELETE(request: Request, context: Context) {
  return endpoint("DELETE /api/admin/uploads/[id]", async () => {
    const { env } = await ownerContext(request);
    checkIntent(request, env);
    await checkWrite(env);
    await cancelUpload(env, (await context.params).id);
    return new Response(null, {
      status: 204,
      headers: { "Cache-Control": "no-store" },
    });
  });
}

export function GET(request: Request, context: Context) {
  return endpoint("GET /api/admin/uploads/[id]", async () => {
    const { env } = await ownerContext(request);
    return json(await uploadResult(env, (await context.params).id));
  });
}
