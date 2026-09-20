import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import ts from "typescript";
import { z } from "zod";
import { operatorFailureHint } from "../src/shared/diagnostics";
export const args = process.argv.slice(2);
export function argument(name: string) {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}
export const local = args.includes("--local");
export const environment = argument("--env");
export const configPath = resolve(argument("--config") ?? "wrangler.jsonc");
if (
  (local && environment) ||
  (!local && !["staging", "production"].includes(environment ?? ""))
)
  throw new Error(
    "Select exactly one target: --local or --env staging|production.",
  );
export const targetFlags = [
  "--config",
  configPath,
  ...(environment ? ["--env", environment] : []),
  local ? "--local" : "--remote",
];
export function wrangler(command: string[], stdin?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("pnpm", ["exec", "wrangler", ...command], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
    });
    let output = "";
    let diagnostic = "";
    child.stdout.on("data", (data: Buffer) => {
      output += data.toString();
    });
    child.stderr.on("data", (data: Buffer) => {
      diagnostic = (diagnostic + data.toString()).slice(-32768);
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve(output)
        : reject(
            new Error(
              `Wrangler ${command.slice(0, 2).join(" ")} failed (exit ${code}). ${operatorFailureHint(diagnostic)} No backup/restore success has been recorded.`,
            ),
          ),
    );
    child.stdin.end(stdin);
  });
}
const bindingSchema = z.object({
  d1_databases: z.array(
    z.object({
      binding: z.string(),
      database_id: z.string(),
      database_name: z.string(),
    }),
  ),
  r2_buckets: z.array(
    z.object({ binding: z.string(), bucket_name: z.string() }),
  ),
  vars: z.record(z.string()),
});
export async function targetConfig() {
  const parsed = ts.parseConfigFileTextToJson(
    configPath,
    await readFile(configPath, "utf8"),
  );
  if (parsed.error) throw new Error("Invalid Wrangler configuration.");
  const config = z
    .object({ env: z.record(z.unknown()).optional() })
    .passthrough()
    .parse(parsed.config);
  const selected = bindingSchema.parse(
    environment ? config.env?.[environment] : config,
  );
  const database = selected.d1_databases.find((d) => d.binding === "DB"),
    bucket = selected.r2_buckets.find((b) => b.binding === "FILES");
  if (!database || !bucket)
    throw new Error("Configure DB and FILES bindings for the selected target.");
  if (
    !local &&
    (/^0{8}-/.test(database.database_id) ||
      selected.vars.APP_BASE_URL?.includes(".invalid"))
  )
    throw new Error("Replace remote configuration placeholders first.");
  return { database, bucket, vars: selected.vars };
}
export async function query<T>(sql: string): Promise<T[]> {
  const output = await wrangler([
    "d1",
    "execute",
    "DB",
    ...targetFlags,
    "--command",
    sql,
    "--json",
  ]);
  const result = z
    .array(z.object({ results: z.array(z.unknown()), success: z.boolean() }))
    .parse(JSON.parse(output));
  if (!result.every((r) => r.success)) throw new Error("D1 query failed.");
  return result.flatMap((r) => r.results) as T[];
}
export async function checksum(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path))
    hash.update(chunk as Buffer);
  return hash.digest("hex");
}
export const objectSchema = z.object({
  id: z.string().uuid(),
  objectKey: z.string().regex(/^(files|avatars)\/[a-f0-9-]{36}$/),
  bytes: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export const manifestSchema = z.object({
  format: z.literal("emboss-backup"),
  version: z.literal(1),
  appVersion: z.string(),
  createdAt: z.string().datetime(),
  databaseId: z.string(),
  bucketName: z.string(),
  configuration: z.record(z.string()),
  databaseSha256: z.string().regex(/^[a-f0-9]{64}$/),
  objects: z.array(objectSchema).max(100000),
});
