// Preserve the generated OpenNext request handler; maintenance uses the same explicit bindings.
import handler from "./.open-next/worker.js";
import { maintenance } from "./src/server/maintenance";
import { prepareRequest, secureResponse } from "./src/server/http/security";
import { publicPageAvailable } from "./src/server/http/public-pages";
import { endpoint, unavailable } from "./src/server/http";
import type { Env } from "./src/server/config";
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const prepared = prepareRequest(request, env);
    if (prepared.response) return prepared.response;
    const path = new URL(request.url).pathname;
    return endpoint(async () => {
      const response = (await publicPageAvailable(path, env))
        ? await handler.fetch(prepared.request!, env, ctx)
        : unavailable();
      return secureResponse(response, prepared.csp!, path);
    });
  },
  async scheduled(_controller: ScheduledController, env: Env) {
    await maintenance(env);
  },
} satisfies ExportedHandler<Env>;
