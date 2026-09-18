import type { Env } from "./config";
import { privateHeaders } from "./http";
// Explicit content-table allowlist: authentication and idempotency records never enter this export.
const tables = [
  "installation",
  "resources",
  "links",
  "pastes",
  "files",
  "blobs",
  "scheduling",
  "business_card",
  "business_card_links",
] as const;
export function metadataExport(env: Env) {
  async function* rows() {
    yield {
      format: "emboss-content",
      version: 1,
      exportedAt: new Date().toISOString(),
    };
    for (const table of tables) {
      let cursor = 0;
      for (;;) {
        const result = await env.DB.prepare(
          `SELECT rowid AS _cursor,* FROM ${table} WHERE rowid>? ORDER BY rowid LIMIT 50`,
        )
          .bind(cursor)
          .all<Record<string, unknown> & { _cursor: number }>();
        if (!result.results.length) break;
        for (const row of result.results) {
          cursor = row._cursor;
          const { _cursor: _skip, claim_id: _claim, ...data } = row;
          yield { table, data };
        }
      }
    }
  }
  const iterator = rows(),
    encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const row = await iterator.next();
          if (row.done) controller.close();
          else
            controller.enqueue(
              encoder.encode(JSON.stringify(row.value) + "\n"),
            );
        } catch (error) {
          controller.error(error);
        }
      },
      async cancel() {
        await iterator.return();
      },
    }),
    {
      headers: {
        ...privateHeaders,
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Content-Disposition": 'attachment; filename="emboss-content.ndjson"',
      },
    },
  );
}
