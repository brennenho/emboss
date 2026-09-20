import { z } from "zod";
import { bindings, ownerContext } from "@/server/runtime";
import { ownerCreate, ownerList } from "@/server/owner";
import { checkIntent, endpoint, json, readJson } from "@/server/http";
import { idempotencyKey } from "@/server/resource-store";
import { AppError } from "@/shared/errors";
const kinds = { links: "link", pastes: "paste", files: "file" } as const;
type Context = { params: Promise<{ kind: string }> };
export const dynamic = "force-dynamic";
export function GET(request: Request, context: Context) {
  return endpoint("GET /api/admin/[kind]", async () => {
    await ownerContext(request);
    const { kind } = await context.params;
    if (!Object.hasOwn(kinds, kind))
      throw new AppError(404, "NOT_FOUND", "Not found.");
    return json(
      await ownerList(
        kinds[kind as keyof typeof kinds],
        Object.fromEntries(new URL(request.url).searchParams),
        request,
      ),
    );
  });
}
export function POST(request: Request, context: Context) {
  return endpoint("POST /api/admin/[kind]", async () => {
    const env = bindings();
    checkIntent(request, env);
    await ownerContext(request);
    const { kind } = await context.params;
    if (kind !== "links" && kind !== "pastes")
      throw new AppError(404, "NOT_FOUND", "Not found.");
    const input = await readJson(
      request,
      z.unknown(),
      kind === "pastes" ? 2 * 1024 ** 2 : 65536,
    );
    return json(
      await ownerCreate(
        kind === "links" ? "link" : "paste",
        input,
        idempotencyKey(request),
        request,
      ),
      201,
    );
  });
}
