"use client";
import { useRef, useState } from "react";
import { Upload, X, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { api, ApiError } from "@/shared/client-api";
import { MutationFeedback } from "./mutation-feedback";
import { useEditorGuard } from "./navigation-guard";
import type { ResourceDto } from "@/shared/resources";
export type UploadResult = {
  uploadId: string;
  state: string;
  leaseExpiresAt: string;
  resource?: ResourceDto;
};
type Job = {
  id: string;
  file: File;
  key: string;
  state: "queued" | "uploading" | "complete" | "failed" | "cancelled";
  progress: number;
  error: ApiError | null;
  result?: UploadResult;
  xhr?: XMLHttpRequest;
  cancelled: boolean;
};
export function UploadControl({
  maxBytes,
  avatar = false,
  onComplete,
}: {
  maxBytes: number;
  avatar?: boolean;
  onComplete: (result: UploadResult) => void;
}) {
  const input = useRef<HTMLInputElement>(null),
    jobs = useRef<Job[]>([]),
    active = useRef(0);
  const [snapshot, setSnapshot] = useState<Job[]>([]),
    [drag, setDrag] = useState(false),
    [error, setError] = useState<ApiError | null>(null);
  useEditorGuard(
    snapshot.some((j) => ["queued", "uploading"].includes(j.state)),
  );
  function render() {
    setSnapshot(jobs.current.map((j) => ({ ...j })));
  }
  async function cancel(job: Job) {
    job.cancelled = true;
    job.xhr?.abort();
    job.state = "cancelled";
    render();
    if (job.result) {
      try {
        await api(`/api/admin/uploads/${job.result.uploadId}`, "DELETE", {});
      } catch (e) {
        job.error = e as ApiError;
        render();
      }
    }
  }
  function pump() {
    while (active.current < 2) {
      const job = jobs.current.find((j) => j.state === "queued");
      if (!job) return;
      active.current++;
      job.state = "uploading";
      render();
      void transfer(job).finally(() => {
        active.current--;
        render();
        pump();
      });
    }
  }
  async function transfer(job: Job) {
    try {
      const result = await api<UploadResult>(
        avatar ? "/api/admin/business-card/avatar" : "/api/admin/files",
        "POST",
        { filename: job.file.name, bytes: job.file.size, title: "" },
        job.key,
      );
      job.result = result;
      if (job.cancelled) {
        await api(`/api/admin/uploads/${result.uploadId}`, "DELETE", {});
        return;
      }
      if (result.state !== "ready")
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          job.xhr = xhr;
          xhr.open("PUT", `/api/admin/uploads/${result.uploadId}`);
          xhr.setRequestHeader("Content-Type", "application/octet-stream");
          xhr.setRequestHeader("X-Emboss-Request", "1");
          xhr.timeout = 11 * 60 * 1000;
          xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
              job.progress = Math.round((event.loaded / event.total) * 100);
              render();
            }
          };
          xhr.onload = () => {
            let body;
            try {
              body = JSON.parse(xhr.responseText) as UploadResult & {
                error?: {
                  code: string;
                  message: string;
                  fields?: Record<string, string>;
                };
              };
            } catch {
              reject(
                new ApiError(
                  xhr.status,
                  "FAILED",
                  "The upload response was lost. Retry to check its status.",
                ),
              );
              return;
            }
            if (xhr.status >= 200 && xhr.status < 300) {
              job.result = body;
              resolve();
            } else
              reject(
                new ApiError(
                  xhr.status,
                  body.error?.code ?? "FAILED",
                  body.error?.message ?? "Upload failed.",
                  body.error?.fields,
                ),
              );
          };
          xhr.onerror = () =>
            reject(
              new ApiError(
                0,
                "OFFLINE",
                "The connection was lost. Retry when you are online.",
              ),
            );
          xhr.ontimeout = () =>
            reject(
              new ApiError(
                0,
                "TIMEOUT",
                "The upload timed out. Retry to check its status.",
              ),
            );
          xhr.onabort = () =>
            reject(new ApiError(0, "CANCELLED", "Upload cancelled."));
          xhr.send(job.file);
        });
      if (!job.cancelled) {
        job.state = "complete";
        job.progress = 100;
        onComplete(job.result);
      }
    } catch (e) {
      if (!job.cancelled) {
        job.state = "failed";
        job.error =
          e instanceof ApiError
            ? e
            : new ApiError(0, "FAILED", "Upload failed. Try again.");
      }
    }
  }
  async function retry(job: Job) {
    job.error = null;
    try {
      if (job.result) {
        const previous = await api<UploadResult>(
          `/api/admin/uploads/${job.result.uploadId}`,
        );
        if (previous.state === "ready") {
          job.state = "complete";
          job.progress = 100;
          job.result = previous;
          onComplete(previous);
          render();
          return;
        }
        await api(`/api/admin/uploads/${previous.uploadId}`, "DELETE", {});
        if (previous.resource)
          await api(`/api/admin/files/${previous.resource.id}`, "DELETE", {
            expectedRevision: previous.resource.revision,
          });
        job.key = crypto.randomUUID();
        job.result = undefined;
      }
      job.cancelled = false;
      job.progress = 0;
      job.state = "queued";
      render();
      pump();
    } catch (e) {
      job.error = e as ApiError;
      render();
    }
  }
  function add(files: FileList | File[] | null) {
    if (!files) return;
    setError(null);
    for (const file of Array.from(files)) {
      if (file.size === 0 || file.size > maxBytes) {
        setError(
          new ApiError(
            413,
            "TOO_LARGE",
            `${file.name}: choose a nonempty file up to ${(maxBytes / 1024 ** 2).toFixed(0)} MiB.`,
          ),
        );
        continue;
      }
      jobs.current.push({
        id: crypto.randomUUID(),
        key: crypto.randomUUID(),
        file,
        state: "queued",
        progress: 0,
        error: null,
        cancelled: false,
      });
      if (avatar) break;
    }
    render();
    pump();
  }
  return (
    <div className="form-stack">
      <div
        className={`flex flex-wrap items-center justify-between gap-4 border border-dashed p-5 ${drag ? "bg-accent border-primary" : "bg-card border-input"}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          add(e.dataTransfer.files);
        }}
      >
        <div>
          <p className="font-medium">
            {avatar ? "Choose an avatar" : "Drop files here"}
          </p>
          <p className="muted">
            {avatar ? "PNG, JPEG, or WebP" : "Each file gets its own address"} ·
            up to {(maxBytes / 1024 ** 2).toFixed(0)} MiB
          </p>
        </div>
        <input
          ref={input}
          type="file"
          multiple={!avatar}
          accept={avatar ? "image/png,image/jpeg,image/webp" : undefined}
          className="sr-only"
          tabIndex={-1}
          aria-label={avatar ? "Avatar file" : "Files to upload"}
          onChange={(e) => {
            add(e.target.files);
            e.target.value = "";
          }}
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => input.current?.click()}
        >
          <Upload />
          {avatar ? "Choose image" : "Choose files"}
        </Button>
      </div>
      <MutationFeedback
        error={error}
        onReauthenticated={() => setError(null)}
      />
      {snapshot.map((job) => (
        <div className="border-b pb-3" key={job.id}>
          <div className="flex items-center justify-between gap-3">
            <span className="min-w-0 text-sm break-all">{job.file.name}</span>
            <span className="muted shrink-0" role="status">
              {job.state === "uploading"
                ? `${job.progress}%${job.progress === 100 ? " · finishing…" : ""}`
                : job.state}
            </span>
            {["queued", "uploading"].includes(job.state) && (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={`Cancel ${job.file.name}`}
                onClick={() => void cancel(job)}
              >
                <X />
              </Button>
            )}
            {["failed", "cancelled"].includes(job.state) && (
              <Button
                type="button"
                variant="outline"
                onClick={() => void retry(job)}
              >
                <RotateCcw />
                Retry
              </Button>
            )}
          </div>
          {job.state === "uploading" && (
            <Progress
              value={job.progress}
              aria-label={`${job.file.name} upload progress`}
              className="mt-2"
            />
          )}
          <MutationFeedback
            error={job.error}
            onReauthenticated={() => {
              job.error = null;
              render();
            }}
          />
        </div>
      ))}
    </div>
  );
}
