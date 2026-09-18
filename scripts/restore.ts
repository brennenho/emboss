import { readFile, mkdtemp, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { spawn } from "node:child_process";
import {
  args,
  argument,
  local,
  environment,
  configPath,
  targetConfig,
  targetFlags,
  wrangler,
  query,
  checksum,
  manifestSchema,
} from "./operator";
const directory = argument("--directory");
if (!directory || !args.includes("--ack-new-resources"))
  throw new Error(
    "Select an existing backup --directory and --ack-new-resources. Restore only into new, unserved D1/R2 resources.",
  );
if (args.includes("--fixture") && !local)
  throw new Error("Fixtures are local only.");
const root = resolve(directory),
  manifest = manifestSchema.parse(
    JSON.parse(await readFile(join(root, "manifest.json"), "utf8")),
  ),
  target = await targetConfig();
if (
  target.database.database_id === manifest.databaseId ||
  target.bucket.bucket_name === manifest.bucketName
)
  throw new Error(
    "The target must use a different D1 database and R2 bucket from the backup source.",
  );
if (target.vars.READ_ONLY_MODE !== "true")
  throw new Error(
    "Keep the new target in READ_ONLY_MODE=true until smoke checks pass.",
  );
const tables = await query<{ name: string }>(
  "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name!='d1_migrations'",
);
if (tables.length)
  throw new Error(
    "Refusing to restore into a database with existing application tables.",
  );
if ((await checksum(join(root, "database.sql"))) !== manifest.databaseSha256)
  throw new Error("Database checksum mismatch.");
for (const object of manifest.objects) {
  const path = join(root, "objects", object.id);
  if (
    (await stat(path)).size !== object.bytes ||
    (await checksum(path)) !== object.sha256
  )
    throw new Error(`Object checksum mismatch: ${object.id}`);
}
console.log(
  `Restoring ${manifest.objects.length} verified objects to new ${local ? "local" : "remote"} resources. Do not attach a public route yet.`,
);
await wrangler([
  "d1",
  "execute",
  "DB",
  ...targetFlags,
  "--file",
  join(root, "database.sql"),
  "--yes",
]);
// Immediately invalidate every restored login, even if binary restoration or password setup fails.
await query(
  "DELETE FROM admin_sessions; UPDATE auth_state SET active_credential_id='restore-awaiting-password',session_generation=lower(hex(randomblob(32))),updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER) WHERE id=1;",
);
const scratch = await mkdtemp(join(tmpdir(), "emboss-restore-"));
try {
  for (const object of manifest.objects) {
    await wrangler([
      "r2",
      "object",
      "put",
      `${target.bucket.bucket_name}/${object.objectKey}`,
      ...targetFlags,
      "--file",
      join(root, "objects", object.id),
      "--content-type",
      "application/octet-stream",
    ]);
    const checkPath = join(scratch, "verify");
    await wrangler([
      "r2",
      "object",
      "get",
      `${target.bucket.bucket_name}/${object.objectKey}`,
      ...targetFlags,
      "--file",
      checkPath,
    ]);
    if ((await checksum(checkPath)) !== object.sha256)
      throw new Error(`Restored object checksum mismatch: ${object.id}`);
    await rm(checkPath);
  }
  const refs = await query<{ id: string }>(
    "SELECT b.id FROM blobs b WHERE b.state='ready' AND b.stored_bytes>0",
  );
  const ids = new Set(manifest.objects.map((o) => o.id));
  if (refs.some((row) => !ids.has(row.id)))
    throw new Error("A ready object is missing from the backup manifest.");
  // No in-flight upload can resume against the new Worker.
  await query(
    "UPDATE blobs SET state='pending_delete',purge_after=CAST(unixepoch('subsec')*1000 AS INTEGER) WHERE state IN ('reserved','uploading'); DELETE FROM idempotency_keys;",
  );
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "pnpm",
      [
        "admin:password",
        ...(local ? ["--local"] : ["--env", environment!]),
        "--config",
        configPath,
        ...(args.includes("--fixture") ? ["--fixture"] : []),
      ],
      { stdio: "inherit" },
    );
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              "Password setup is incomplete. Keep the target unserved and rerun admin:password against its configuration.",
            ),
          ),
    );
  });
  await writeFile(
    join(root, `restore-${Date.now()}.json`),
    JSON.stringify({
      restoredAt: new Date().toISOString(),
      databaseId: target.database.database_id,
      bucketName: target.bucket.bucket_name,
      objects: manifest.objects.length,
    }),
    { mode: 0o600 },
  );
  console.log(
    "Restore verified; all old sessions are invalid. Smoke-test the new Worker, then disable read-only mode before switching the domain.",
  );
} finally {
  await rm(scratch, { recursive: true, force: true });
}
