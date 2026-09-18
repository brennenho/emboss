import { mkdir, writeFile, stat, copyFile, rm } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { resolve, join } from "node:path";
import {
  args,
  argument,
  local,
  targetConfig,
  targetFlags,
  wrangler,
  query,
  checksum,
  manifestSchema,
} from "./operator";
const directory = argument("--directory");
if (!directory || !args.includes("--ack-read-only"))
  throw new Error(
    "Use --directory /independent/backup/path --ack-read-only after pausing writes and draining uploads.",
  );
const target = await targetConfig();
if (target.vars.READ_ONLY_MODE !== "true")
  throw new Error(
    "Set READ_ONLY_MODE=true, apply it to the running Worker, and drain uploads before backing up.",
  );
const pending = await query<{ count: number }>(
  `SELECT count(*) count FROM blobs WHERE state='uploading' OR (state='pending_delete' AND claim_id IS NOT NULL AND stored_bytes=0 AND lease_expires_at>${Date.now()})`,
);
if (pending[0]?.count)
  throw new Error(
    "Uploads are still unsettled. Run maintenance and allow leases to settle before backup.",
  );
const root = resolve(directory);
await mkdir(root, { mode: 0o700 });
await mkdir(join(root, "objects"), { mode: 0o700 });
console.log(
  `Backing up ${local ? "local" : "remote"} DB ${target.database.database_name} and R2 ${target.bucket.bucket_name}. Keep this directory private.`,
);
// D1's ordinary dump can insert child rows before parent tables exist. Export
// all schema first, then data, so deferred foreign keys work during restoration.
const schemaPath = join(root, "schema.sql"),
  dataPath = join(root, "data.sql");
await wrangler([
  "d1",
  "export",
  "DB",
  ...targetFlags,
  "--no-data",
  "--output",
  schemaPath,
]);
await wrangler([
  "d1",
  "export",
  "DB",
  ...targetFlags,
  "--no-schema",
  "--output",
  dataPath,
]);
await copyFile(schemaPath, join(root, "database.sql"));
await pipeline(
  createReadStream(dataPath),
  createWriteStream(join(root, "database.sql"), { flags: "a", mode: 0o600 }),
);
await rm(schemaPath);
await rm(dataPath);
const objects: {
  id: string;
  objectKey: string;
  bytes: number;
  sha256: string;
}[] = [];
let cursor = "";
for (;;) {
  const rows = await query<{
    id: string;
    object_key: string;
    expected_bytes: number;
    state: string;
    stored_bytes: number;
  }>(
    `SELECT id,object_key,expected_bytes,state,stored_bytes FROM blobs WHERE state IN ('ready','pending_delete') AND stored_bytes>0 AND id>'${cursor}' ORDER BY id LIMIT 100`,
  );
  if (!rows.length) break;
  for (const row of rows) {
    if (
      !/^[a-f0-9-]{36}$/.test(row.id) ||
      !/^(files|avatars)\/[a-f0-9-]{36}$/.test(row.object_key)
    )
      throw new Error("Unexpected object identity in database.");
    const path = join(root, "objects", row.id);
    await wrangler([
      "r2",
      "object",
      "get",
      `${target.bucket.bucket_name}/${row.object_key}`,
      ...targetFlags,
      "--file",
      path,
    ]);
    if ((await stat(path)).size !== row.expected_bytes)
      throw new Error(`Object size mismatch: ${row.id}`);
    objects.push({
      id: row.id,
      objectKey: row.object_key,
      bytes: row.expected_bytes,
      sha256: await checksum(path),
    });
    cursor = row.id;
  }
}
const manifest = manifestSchema.parse({
  format: "emboss-backup",
  version: 1,
  appVersion: "0.1.0",
  createdAt: new Date().toISOString(),
  databaseId: target.database.database_id,
  bucketName: target.bucket.bucket_name,
  configuration: Object.fromEntries(
    Object.entries(target.vars).filter(([key]) =>
      [
        "APP_ENV",
        "APP_BASE_URL",
        "SESSION_TTL_SECONDS",
        "UPLOAD_MAX_BYTES",
        "STORAGE_QUOTA_BYTES",
        "PASTE_MAX_BYTES",
        "DELETION_RETENTION_DAYS",
        "READ_ONLY_MODE",
      ].includes(key),
    ),
  ),
  databaseSha256: await checksum(join(root, "database.sql")),
  objects,
});
await writeFile(
  join(root, "manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
  { mode: 0o600 },
);
console.log(
  `Backup complete: ${objects.length} objects, SQL and SHA-256 manifest. Copy it outside the Cloudflare account; restore normal operation when finished.`,
);
