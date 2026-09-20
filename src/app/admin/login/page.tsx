import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { PasswordForm } from "@/features/auth/password-form";
import { bindings } from "@/server/runtime";
import { config } from "@/server/config";
import { requireSession } from "@/server/auth/session";
import { AppError } from "@/shared/errors";
import { Brand } from "@/components/shell/brand";
export const metadata = { title: "Sign in" };
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
        <div className="login-brand">
          <Brand />
          <p className="brand-host">{new URL(config(env).origin).host}</p>
        </div>
        <h1>Sign in</h1>
        <PasswordForm />
      </section>
    </main>
  );
}
