import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { PasswordForm } from "@/features/auth/password-form";
import { bindings } from "@/server/runtime";
import { config } from "@/server/config";
import { requireSession } from "@/server/auth/session";
import { AppError } from "@/shared/errors";
export default async function LoginPage() {
  const env = bindings();
  let signedIn = false;
  try {
    await requireSession(env, await headers());
    signedIn = true;
  } catch (error) {
    if (!(error instanceof AppError) || ![401, 503].includes(error.status))
      throw error;
  }
  if (signedIn) redirect("/admin/links");
  return (
    <main className="login-shell">
      <section className="login-panel">
        <div className="wordmark">
          <span className="mark" aria-hidden="true" />
          EMBOSS
        </div>
        <p className="muted font-mono">{new URL(config(env).origin).host}</p>
        <h1>Sign in to your tools</h1>
        <PasswordForm />
      </section>
    </main>
  );
}
