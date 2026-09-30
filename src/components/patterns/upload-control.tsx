"use client";
import { EditorReady } from "@/components/patterns/editor-ready";
import { useRef, useState } from "react";
import { Upload, X, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { api, ApiError } from "@/shared/client-api";
import { MutationFeedback } from "./mutation-feedback";
import { useEditorGuard } from "./navigation-guard";
import { formatBytes } from "@/shared/format";
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
  state:
    "queued" | "uploading" | "checking" | "complete" | "failed" | "cancelled";
  progress: number;
  error: ApiError | null;
  result?: UploadResult;
  xhr?: XMLHttpRequest;
  cancelled: boolean;
  running: boolean;
  cancelling: boolean;
};

function uploadStatus(job: Job, avatar: boolean) {
  switch (job.state) {
    case "uploading":
      return job.progress === 100 ? "Finishing…" : `${job.progress}%`;
    case "complete":
      return avatar ? "Uploaded" : "Uploaded · Only you";
    case "queued":
      return "Waiting";
    case "checking":
      return "Checking upload…";
    case "failed":
      return "Upload failed";
    case "cancelled":
      return "Cancelled";
  }
}
export function UploadControl({
  maxBytes,
  avatar = false,
  onComplete,
  onReview,
  availableBytes,
}: {
  maxBytes: number;
  avatar?: boolean;
  onComplete: (result: UploadResult) => void;
  onReview?: (resource: ResourceDto) => void;
  availableBytes?: number;
}) {
  const input = useRef<HTMLInputElement>(null),
    jobs = useRef<Job[]>([]),
    active = useRef(0);
  const [snapshot, setSnapshot] = useState<Job[]>([]),
    [drag, setDrag] = useState(false),
    [error, setError] = useState<ApiError | null>(null);
  useEditorGuard(
    snapshot.some(
      (job) =>
        job.running ||
        job.cancelling ||
        ["queued", "checking"].includes(job.state),
    ),
    "pathname",
  );
  function render() {
    setSnapshot([...jobs.current]);
  }
  async function cancel(job: Job) {
    job.cancelled = true;
    job.cancelling = true;
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
    job.cancelling = false;
    render();
  }
  function dismiss(job: Job) {
    jobs.current = jobs.current.filter((candidate) => candidate.id !== job.id);
    render();
  }
  function pump() {
    while (active.current < 2) {
      const job = jobs.current.find((j) => j.state === "queued");
      if (!job) return;
      active.current++;
      job.running = true;
      job.state = "uploading";
      render();
      void transfer(job).finally(() => {
        active.current--;
        job.running = false;
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
                  "Could not confirm the upload. Retry to check.",
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
                "Connection lost. Reconnect and retry.",
              ),
            );
          xhr.ontimeout = () =>
            reject(
              new ApiError(0, "TIMEOUT", "Upload timed out. Retry to check."),
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
    if (
      job.running ||
      job.cancelling ||
      !["failed", "cancelled"].includes(job.state)
    )
      return;
    job.state = "checking";
    job.error = null;
    render();
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
      job.state = "failed";
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
            `${file.name}: choose a nonempty file up to ${formatBytes(maxBytes)}.`,
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
        running: false,
        cancelling: false,
      });
      if (avatar) break;
    }
    render();
    pump();
  }
  return (
    <EditorReady>
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
              {avatar ? "Drop an image here" : "Drop files here"}
            </p>
            <p className="muted">
              {avatar ? "PNG, JPEG, or WebP · " : ""}Up to{" "}
              {formatBytes(maxBytes)}
              {avatar ? "" : " per file"}
            </p>
            {!avatar && availableBytes !== undefined && (
              <p className="muted">{formatBytes(availableBytes)} available</p>
            )}
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
        {snapshot.map((job) => {
          const resource = job.result?.resource;
          return (
            <div
              className="upload-job border-b pb-3"
              data-state={job.state}
              key={job.id}
            >
              <div className="upload-job-top flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm break-all">{job.file.name}</p>
                  <p className="muted">{formatBytes(job.file.size)}</p>
                </div>
                <span className="muted shrink-0" role="status">
                  {uploadStatus(job, avatar)}
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
                {job.state === "complete" && (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={`Dismiss ${job.file.name}`}
                    onClick={() => dismiss(job)}
                  >
                    <X />
                  </Button>
                )}
                {["failed", "cancelled"].includes(job.state) && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={job.running || job.cancelling}
                    onClick={() => void retry(job)}
                  >
                    <RotateCcw />
                    Retry
                  </Button>
                )}
              </div>
              {job.state === "complete" && resource && onReview && (
                <Button
                  type="button"
                  variant="outline"
                  className="upload-result-action mt-3"
                  onClick={() => {
                    onReview(resource);
                    dismiss(job);
                  }}
                >
                  Review and publish
                </Button>
              )}
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
          );
        })}
      </div>
    </EditorReady>
  );
}
