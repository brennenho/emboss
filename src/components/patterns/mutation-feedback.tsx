"use client";
import { useRef, useState } from "react";
import { ApiError } from "@/shared/client-api";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PasswordForm } from "@/features/auth/password-form";
export function useMutation() {
  const running = useRef(false);
  const [error, setError] = useState<ApiError | null>(null),
    [pending, setPending] = useState(false),
    [notice, setNotice] = useState("");
  async function run<T>(action: () => Promise<T>): Promise<T | undefined> {
    if (running.current) return;
    running.current = true;
    setPending(true);
    setError(null);
    setNotice("");
    try {
      return await action();
    } catch (error) {
      setError(
        error instanceof ApiError
          ? error
          : new ApiError(
              0,
              "FAILED",
              error instanceof Error
                ? error.message
                : "Could not complete the action. Try again.",
            ),
      );
    } finally {
      running.current = false;
      setPending(false);
    }
  }
  return { error, setError, pending, notice, setNotice, run };
}
export function MutationFeedback({
  error,
  notice,
  onReauthenticated,
}: {
  error: ApiError | null;
  notice?: string;
  onReauthenticated: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            <span>{error.message}</span>
            {error.status === 401 && (
              <Dialog open={open} onOpenChange={setOpen}>
                <DialogTrigger asChild>
                  <Button type="button" variant="outline">
                    Sign in again
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Continue editing</DialogTitle>
                    <DialogDescription>
                      Sign in to continue. Your edits are still here.
                    </DialogDescription>
                  </DialogHeader>
                  <PasswordForm
                    onSuccess={() => {
                      setOpen(false);
                      onReauthenticated();
                    }}
                  />
                </DialogContent>
              </Dialog>
            )}
          </AlertDescription>
        </Alert>
      )}
      {notice && (
        <p role="status" className="text-success text-sm">
          {notice}
        </p>
      )}
    </>
  );
}
