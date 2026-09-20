import { ZodError, type ZodTypeAny, type output } from "zod";
import { AppError } from "../../shared/errors";
import { config, type Env } from "../config";
import { failureCategory } from "../../shared/diagnostics";

export const privateHeaders = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
};
export function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: privateHeaders });
}
export function unavailable() {
  return new Response("This share is unavailable", {
    status: 404,
    headers: { ...privateHeaders, "Content-Type": "text/plain; charset=utf-8" },
  });
}
export function checkIntent(
  request: Request,
  env: Env,
  type = "application/json",
) {
  if (
    request.headers.get("origin") !== config(env).origin ||
    request.headers.get("x-emboss-request") !== "1"
  )
    throw new AppError(403, "FORBIDDEN", "Reload this page and try again.");
  if (request.headers.get("content-type")?.split(";")[0]?.trim() !== type)
    throw new AppError(400, "INVALID_CONTENT_TYPE", `Expected ${type}.`);
}
export async function readJson<T extends ZodTypeAny>(
  request: Request,
  schema: T,
  maxBytes = 65536,
): Promise<output<T>> {
  if (Number(request.headers.get("content-length")) > maxBytes)
    throw new AppError(413, "TOO_LARGE", "The request is too large.");
  const reader = request.body?.getReader();
  if (!reader)
    throw new AppError(400, "INVALID_JSON", "A request body is required.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.length;
      if (total > maxBytes) {
        await reader.cancel();
        throw new AppError(413, "TOO_LARGE", "The request is too large.");
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new AppError(
      400,
      "INVALID_JSON",
      "The request contains invalid JSON.",
    );
  }
  return schema.parse(value);
}
export async function endpoint(
  operation: string,
  action: () => Promise<Response>,
): Promise<Response> {
  const requestId = crypto.randomUUID();
  try {
    const response = await action();
    if (!response.headers.has("X-Request-Id"))
      response.headers.set("X-Request-Id", requestId);
    return response;
  } catch (error) {
    let appError: AppError;
    if (error instanceof AppError) appError = error;
    else if (error instanceof ZodError)
      appError = new AppError(
        400,
        "VALIDATION",
        "Check the highlighted fields.",
        Object.fromEntries(
          error.issues.map((issue) => [issue.path.join("."), issue.message]),
        ),
      );
    else {
      console.error(
        JSON.stringify({
          operation,
          category: failureCategory(error),
          status: 503,
          requestId,
        }),
      );
      appError = new AppError(
        503,
        "UNAVAILABLE",
        "The service is temporarily unavailable. Try again.",
      );
    }
    const response = json(
      {
        error: {
          code: appError.code,
          message: appError.message,
          fields: appError.fields,
          requestId,
        },
      },
      appError.status,
    );
    if (appError.status === 429) response.headers.set("Retry-After", "60");
    return response;
  }
}
export async function checkWrite(env: Env) {
  if (config(env).READ_ONLY_MODE === "true")
    throw new AppError(
      503,
      "READ_ONLY",
      "Changes are paused for maintenance. Try again later.",
    );
  if (
    !env.WRITE_RATE_LIMITER ||
    !(await env.WRITE_RATE_LIMITER.limit({ key: "owner-writes" })).success
  )
    throw new AppError(
      429,
      "RATE_LIMITED",
      "Too many changes. Try again in one minute.",
    );
}
