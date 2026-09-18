import { z } from "zod";
import { bindings, ownerContext } from "@/server/runtime";
import { ownerDelete, ownerResource, ownerUpdate } from "@/server/owner";
import {
  checkIntent,
  endpoint,
  json,
  privateHeaders,
  readJson,
} from "@/server/http";
import { AppError } from "@/shared/errors";
const kinds = { links: "link", pastes: "paste", files: "file" } as const;
type Context = { params: Promise<{ kind: string; id: string }> };
async function parameters(context: Context) {
  const { kind, id } = await context.params;
  if (!Object.hasOwn(kinds, kind))
    throw new AppError(404, "NOT_FOUND", "Not found.");
  return { kind: kinds[kind as keyof typeof kinds], id };
}
export const dynamic = "force-dynamic";
export function GET(request: Request, context: Context) {
  return endpoint(async () => {
    await ownerContext(request);
    const { kind, id } = await parameters(context);
    return json(await ownerResource(kind, id, request));
  });
}
export function PATCH(request: Request, context: Context) {
  return endpoint(async () => {
    checkIntent(request, bindings());
    await ownerContext(request);
    const { kind, id } = await parameters(context);
    const input = await readJson(
      request,
      z.unknown(),
      kind === "paste" ? 2 * 1024 ** 2 : 65536,
    );
    return json(await ownerUpdate(kind, id, input, request));
  });
}
export function DELETE(request: Request, context: Context) {
  return endpoint(async () => {
    checkIntent(request, bindings());
    await ownerContext(request);
    const { kind, id } = await parameters(context);
    await ownerDelete(kind, id, await readJson(request, z.unknown()), request);
    return new Response(null, { status: 204, headers: privateHeaders });
  });
}
