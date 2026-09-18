import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import {
  createVerifier,
  parseVerifier,
  randomToken,
  sha256,
} from "../src/server/auth/password";

const args = process.argv.slice(2);
const local = args.includes("--local");
const configIndex = args.indexOf("--config");
const configPath = resolve(
  configIndex >= 0 ? args[configIndex + 1]! : "wrangler.jsonc",
);
const devVars = join(dirname(configPath), ".dev.vars");
const envIndex = args.indexOf("--env");
if (local && envIndex >= 0) throw new Error("Select one password target.");
const target = local ? "local" : args[envIndex + 1];
if (
  (!local && envIndex < 0) ||
  !target ||
  !["local", "staging", "production"].includes(target)
)
  throw new Error("Select --local or --env staging|production.");
const fixture = args.includes("--fixture");
if (fixture && !local) throw new Error("Fixtures are local only.");
const resume = args.includes("--resume");
const directory = ".agent-context/operator";
const pending = `${directory}/password-${target}-${(await sha256(configPath)).slice(0, 12)}.json`;
await mkdir(directory, { recursive: true, mode: 0o700 });
function command(cmdArgs: string[], input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "pnpm",
      ["exec", "wrangler", ...cmdArgs, "--config", configPath],
      {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
      },
    );
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on("data", () => {});
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve(output)
        : reject(
            new Error(
              "Wrangler failed. Configuration remains recoverable; rerun with --resume.",
            ),
          ),
    );
    child.stdin.end(input);
  });
}
async function hidden(prompt: string): Promise<string> {
  if (!process.stdin.isTTY)
    throw new Error("Use an interactive terminal for password entry.");
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let value = "";
    const onData = (text: string) => {
      for (const c of text) {
        if (c === "\u0003") {
          done();
          reject(new Error("Cancelled."));
          return;
        }
        if (c === "\r" || c === "\n") {
          done();
          resolve(value);
          return;
        }
        if (c === "\u007f" || c === "\b")
          value = [...value].slice(0, -1).join("");
        else if (c >= " " || c.charCodeAt(0) > 127) value += c;
      }
    };
    function done() {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
    }
    process.stdin.on("data", onData);
  });
}
console.log(
  `Password target: ${target}. Config: ${configPath}. D1 binding: DB. Secret: ADMIN_PASSWORD_HASH. All admin sessions will be revoked.`,
);
if (!fixture && !resume) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`Type ${target} to continue: `);
  rl.close();
  if (answer !== target) throw new Error("Cancelled.");
}
let state: { verifier: string; credentialId: string; generation: string };
if (resume) {
  state = JSON.parse(await readFile(pending, "utf8")) as typeof state;
  parseVerifier(state.verifier);
  if (
    !/^[a-f0-9]{64}$/.test(state.credentialId) ||
    !/^[A-Za-z0-9_-]{43}$/.test(state.generation) ||
    (await sha256(state.verifier)) !== state.credentialId
  )
    throw new Error("Invalid pending rotation file.");
} else {
  const password = fixture
    ? "Emboss local test password 2026!"
    : await hidden("New admin password: ");
  if (!fixture && password !== (await hidden("Confirm password: ")))
    throw new Error("Passwords do not match.");
  const verifier = await createVerifier(password);
  state = {
    verifier,
    credentialId: await sha256(verifier),
    generation: randomToken(),
  };
  await writeFile(pending, JSON.stringify(state), { mode: 0o600 });
}
// D1 changes first. Any mismatched deployed verifier fails closed until the secret installation succeeds.
const sqlPath = `${directory}/rotate-${target}.sql`;
await writeFile(
  sqlPath,
  `INSERT INTO auth_state(id,active_credential_id,session_generation,updated_at) VALUES(1,'${state.credentialId}','${state.generation}',${Date.now()}) ON CONFLICT(id) DO UPDATE SET active_credential_id=excluded.active_credential_id,session_generation=excluded.session_generation,updated_at=excluded.updated_at;\n`,
  { mode: 0o600 },
);
try {
  await command([
    "d1",
    "execute",
    "DB",
    ...(local ? ["--local"] : ["--remote", "--env", target]),
    "--file",
    sqlPath,
  ]);
  if (local) {
    let vars = "";
    try {
      vars = await readFile(devVars, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    vars = vars
      .split("\n")
      .filter((line) => !line.startsWith("ADMIN_PASSWORD_HASH="))
      .join("\n")
      .trim();
    await writeFile(
      devVars,
      `${vars}${vars ? "\n" : ""}ADMIN_PASSWORD_HASH=${JSON.stringify(state.verifier)}\n`,
      { mode: 0o600 },
    );
  } else
    await command(
      ["secret", "put", "ADMIN_PASSWORD_HASH", "--env", target],
      state.verifier,
    );
  await rm(pending);
  console.log(
    "Password provisioned; previous sessions revoked. Restart local preview if running, then verify sign-in.",
  );
} finally {
  await rm(sqlPath, { force: true });
}
