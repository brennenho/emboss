# Operating Emboss

## Separate local, staging, and production resources

Local commands use emulated resources. `wrangler.jsonc` includes staging and
production templates with **placeholder** database IDs and origins. Replace them
before any remote command. Every environment needs its own Worker, D1 database,
private R2 bucket, self-service binding, rate-limit namespaces, and password secret.
Do not point staging at production data.

With a Cloudflare account/zone you control, create the remote resources:

```sh
pnpm exec wrangler login
pnpm exec wrangler d1 create emboss-staging
pnpm exec wrangler r2 bucket create emboss-staging-files
```

Put the returned D1 ID in `env.staging.d1_databases`. Set the real HTTPS
`env.staging.vars.APP_BASE_URL`; its value is an origin without a path. Keep R2
public development URLs/custom domains disabled. Keep `workers_dev` and
`preview_urls` false so alternate Worker hostnames cannot bypass the canonical
origin. The self-service name must match the selected Worker name.

Set all variables in each environment; binding/variable inheritance is not
assumed. `UPLOAD_MAX_BYTES` has a tested hard ceiling of 25 MiB;
`STORAGE_QUOTA_BYTES` defaults to 1 GiB; `PASTE_MAX_BYTES` is at most 256 KiB;
`SESSION_TTL_SECONDS` is at most 604800. `DELETION_RETENTION_DAYS` defaults to 30.
`READ_ONLY_MODE=true` pauses content/configuration writes and scheduled cleanup,
while login/logout and reads remain usable.

After authorization to deploy that environment:

```sh
pnpm check
pnpm test
pnpm build:worker
pnpm exec wrangler d1 migrations apply DB --remote --env staging
pnpm exec opennextjs-cloudflare deploy --env staging
pnpm admin:password --env staging
```

This first deploy may remain unserved while the password is provisioned. Then
add a custom-domain route to that environment and deploy again:

```json
"routes": [{ "pattern": "staging.your-domain.example", "custom_domain": true }]
```

Use the same hostname in `APP_BASE_URL`. Confirm ownership/TLS before exposing
it. Repeat with separate resources and `--env production` only after production
deployment is approved. The supplied CI workflow checks local emulation only;
it has no deployment credentials or automatic publish step.

## Password setup, rotation, and recovery

```sh
pnpm admin:password --local
pnpm admin:password --env staging
pnpm admin:password --env production
```

The terminal displays the target and asks for confirmation, then reads and
confirms the password without echoing it. Do not pass plaintext via command
arguments, commit it, or put it in a support conversation. The command creates
a random-salt PBKDF2-SHA256 verifier with 600,000 iterations. No weaker production
mode exists.

Credential activation changes D1 first. A database trigger revokes all sessions
atomically. The command then installs `ADMIN_PASSWORD_HASH`. If secret installation
fails, the old secret no longer matches D1 and sign-in fails closed. Resume the
same saved operation:

```sh
pnpm admin:password --env production --resume
```

The pending verifier is stored with restricted permissions in ignored
`.agent-context/operator`. Protect it like a secret and retain it until recovery
completes. `--config path/to/wrangler.jsonc` selects a separate target configuration;
use the same path when resuming. Local secrets are written alongside that config
in `.dev.vars`. Restart local servers after rotation. Never use `--fixture`
remotely; the command rejects it.

Recovery requires operator access to Cloudflare or the local installation. There
is no browser reset email, account record, or secondary authentication service.
Keep independent access to the Cloudflare account and its recovery material.

## Updates and migrations

Back up before schema changes. Review generated SQL, run `pnpm db:migrate` and
all affected tests locally, then apply it to staging before production. Apply
migrations before deploying code that needs them. Prefer backward-compatible
schema changes; a Worker rollback does not undo a migration. Restoring old SQL
requires a matching application version and its migration history.

The two handwritten trigger sets enforce immutable addresses, subtype consistency,
ready-only file publication, and atomic session revocation. Preserve them when
changing the schema; Drizzle snapshots do not model these triggers.

## Cleanup and observability

The custom Worker delegates HTTP to OpenNext and runs bounded maintenance hourly
at minute 17 UTC. It reconciles completed uploads, expires abandoned reservations,
purges due retained objects/content, and removes expired session/idempotency rows.
Deletion failures remain queued. Active or merely expired files are never purged.

To exercise the real local scheduled handler while preview is running:

```sh
curl 'http://127.0.0.1:8787/cdn-cgi/local/scheduled?format=json'
```

A successful result has `outcome: "ok"`. This is Wrangler's local test endpoint,
not an application route. [Cloudflare scheduled-handler documentation](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/).

Review D1/R2 failures, cleanup failures, request latency, and Worker CPU exceptions.
Application errors include safe operation names, status, and request IDs; do not
add logging of passwords, verifiers, cookies, paste bodies, contact details,
uploads, or destination query strings. Review platform request-log retention and
access before release. Configure alerts for repeated scheduled failures or growing
pending/retained storage. The observability sample is configurable in Wrangler.

## Export and consistent backup

Settings → Export metadata downloads versioned NDJSON with content/configuration
and a file manifest. It excludes authentication records and all binary bytes.
It is useful for portability, but is **not a full backup**.

A full SQL backup includes sensitive content and session hashes. Store backups
on encrypted storage, with access limited to the operator, and copy them outside
the Cloudflare account. Keep the password verifier in your separate secret recovery
process, or establish a new password during restore.

1. Set `READ_ONLY_MODE=true` in the selected config and deploy that change.
2. Verify writes are paused. Let in-flight transfers finish (maximum ten minutes),
   then settle any incomplete leases before backup. The script refuses unsettled
   uploading records; if necessary, resume cleanup temporarily after their one-hour
   lease, run maintenance, and pause writes again.
3. Run the backup to a **new** private directory on independent storage:

```sh
pnpm backup --env production --directory /secure-backups/emboss-2026-09-18 --ack-read-only
```

For local emulation, stop the local servers, set the local variable true, and use
`--local` instead. `--ack-read-only` confirms the running target has actually been
paused; reading a config file cannot prove a remote deployment adopted it.

The script exports D1 SQL, copies every ready/retained stored R2 object, validates
sizes, and writes a versioned manifest with SHA-256 checksums and non-secret
configuration. A manifest appears only after all copies succeed. Finally restore
`READ_ONLY_MODE=false` and apply/restart the running target. Keep multiple dated
copies according to your retention policy. D1 recovery history alone cannot
recover purged R2 objects.

## Restore into new resources

Create a **new** D1 database and private R2 bucket. Make a separate Wrangler
configuration with those bindings and `READ_ONLY_MODE=true`; leave it unserved.
Use the app version recorded in the backup. Do not migrate the empty target first:
the SQL backup already contains its schema and migration ledger.

```sh
pnpm restore --env staging --config wrangler-recovery.jsonc \
  --directory /secure-backups/emboss-2026-09-18 --ack-new-resources
```

For an isolated local rehearsal, use a copied config with different database ID
and bucket name and select `--local`. Keep the config and state private.

Restore verifies input checksums, refuses the source resource IDs and existing
application tables, imports SQL, immediately clears restored sessions and changes
the auth generation, uploads objects, and downloads them again to verify hashes.
It checks ready-object references and expires old upload attempts. Then it invokes
the password operator workflow against the **new configuration**, synchronizing
D1 with the intended new Worker secret. Remote password installation requires an
existing unserved target Worker; deploy that new target without routes first.

If a restore fails midway, keep that target unserved. Rehearse into another new
set of resources, or finish password setup if only that final step failed. Do
not switch the domain until restored content, files, password rotation, old-session
rejection, and scheduled cleanup pass smoke tests. Apply any subsequent reviewed
migrations, disable read-only mode, then switch the route. Protect or remove failed
rehearsal resources and temporary backups when no longer needed.

## Release checks requiring a real deployment

Local tests are necessary but do not establish production readiness. On staging,
verify custom-domain TLS, the Secure `__Host-` cookie, alternate-host rejection,
unauthorized page/API/RSC requests, rate-limit bindings, 25 MiB R2 streaming,
range/HEAD and revocation, public cache headers, actual Cron execution, password
rotation/recovery, and a complete independent restore. Import a downloaded vCard
in a real contact application. Measure cold/warm login, rendering, redirect,
upload, and cleanup CPU/latency under the chosen Cloudflare plan. Do not weaken the
KDF or promise free-tier hosting to satisfy a budget assumption.
