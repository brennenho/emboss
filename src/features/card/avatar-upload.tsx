"use client";
import { useEffect, useRef, useState } from "react";
import { ImagePlus, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  MutationFeedback,
  useMutation,
} from "@/components/patterns/mutation-feedback";
import { useEditorGuard } from "@/components/patterns/navigation-guard";
import { api, ApiError } from "@/shared/client-api";
import { formatBytes } from "@/shared/format";
import type { UploadResult } from "@/components/patterns/upload-control";

type Attempt = { bytes: Blob; key: string; uploadId?: string };
export function AvatarUpload({
  maxBytes,
  onComplete,
  onPendingChange,
}: {
  maxBytes: number;
  onComplete: (id: string) => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [image, setImage] = useState<ImageBitmap | null>(null);
  const [crop, setCrop] = useState({ zoom: 1, x: 50, y: 50 });
  const [decoding, setDecoding] = useState(false);
  const mutation = useMutation();
  const attempt = useRef<Attempt | null>(null);
  const sequence = useRef(0);
  useEditorGuard(image !== null || decoding || mutation.pending);

  useEffect(
    () => () => {
      image?.close();
    },
    [image],
  );
  useEffect(
    () => () => {
      sequence.current++;
    },
    [],
  );
  useEffect(() => {
    if (!image || !canvas.current) return;
    const context = canvas.current.getContext("2d");
    if (!context) return;
    const edge = Math.min(image.width, image.height) / crop.zoom;
    context.clearRect(0, 0, 512, 512);
    context.drawImage(
      image,
      ((image.width - edge) * crop.x) / 100,
      ((image.height - edge) * crop.y) / 100,
      edge,
      edge,
      0,
      0,
      512,
      512,
    );
  }, [image, crop]);

  async function choose(file?: File) {
    if (!file) return;
    mutation.setError(null);
    mutation.setNotice("");
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
      file.size > 20 * 1024 ** 2 ||
      !file.size
    ) {
      mutation.setError(
        new ApiError(
          400,
          "INVALID_IMAGE",
          "Choose a PNG, JPEG, or WebP image up to 20 MB.",
        ),
      );
      return;
    }
    const current = ++sequence.current;
    setDecoding(true);
    onPendingChange(true);
    try {
      const bitmap = await createImageBitmap(file, {
        imageOrientation: "from-image",
      });
      if (current !== sequence.current) {
        bitmap.close();
        return;
      }
      if (
        !bitmap.width ||
        !bitmap.height ||
        bitmap.width * bitmap.height > 80_000_000
      ) {
        bitmap.close();
        throw new Error("Choose an image smaller than 80 megapixels.");
      }
      attempt.current = null;
      setCrop({ zoom: 1, x: 50, y: 50 });
      setImage(bitmap);
    } catch (error) {
      if (current === sequence.current) {
        mutation.setError(
          new ApiError(
            400,
            "INVALID_IMAGE",
            error instanceof Error
              ? error.message
              : "This image could not be opened. Try another image.",
          ),
        );
        onPendingChange(image !== null);
      }
    } finally {
      if (current === sequence.current) setDecoding(false);
    }
  }
  function adjust(next: typeof crop) {
    attempt.current = null;
    setCrop(next);
  }
  async function upload() {
    const result = await mutation.run(async () => {
      if (!canvas.current || !image) throw new Error("Choose an image first.");
      if (!attempt.current) {
        const bytes = await new Promise<Blob>((resolve, reject) =>
          canvas.current!.toBlob(
            (blob) =>
              blob
                ? resolve(blob)
                : reject(
                    new Error(
                      "The crop could not be prepared. Try another image.",
                    ),
                  ),
            "image/png",
          ),
        );
        if (bytes.size > maxBytes)
          throw new Error(
            `The cropped image is too large. Choose a simpler image, up to ${formatBytes(maxBytes)} after cropping.`,
          );
        attempt.current = { bytes, key: crypto.randomUUID() };
      }
      const current = attempt.current;
      if (current.uploadId) {
        const previous = await api<UploadResult>(
          `/api/admin/uploads/${current.uploadId}`,
        );
        if (previous.state === "ready") return previous;
        if (previous.state !== "reserved") {
          await api(`/api/admin/uploads/${current.uploadId}`, "DELETE", {});
          current.uploadId = undefined;
          current.key = crypto.randomUUID();
        }
      }
      const reservation = await api<UploadResult>(
        "/api/admin/business-card/avatar",
        "POST",
        {
          filename: "portrait.png",
          bytes: current.bytes.size,
          title: "",
        },
        current.key,
      );
      current.uploadId = reservation.uploadId;
      if (reservation.state === "ready") return reservation;
      let response: Response;
      try {
        response = await fetch(`/api/admin/uploads/${reservation.uploadId}`, {
          method: "PUT",
          credentials: "same-origin",
          cache: "no-store",
          headers: {
            "Content-Type": "application/octet-stream",
            "X-Emboss-Request": "1",
          },
          body: current.bytes,
          signal: AbortSignal.timeout(120_000),
        });
      } catch {
        throw new ApiError(
          0,
          "OFFLINE",
          "The upload was interrupted. Retry to check whether it finished.",
        );
      }
      const body = (await response.json()) as UploadResult & {
        error?: { code: string; message: string };
      };
      if (!response.ok)
        throw new ApiError(
          response.status,
          body.error?.code ?? "FAILED",
          body.error?.message ??
            "The image could not be uploaded. Retry to check.",
        );
      return body;
    });
    if (result) {
      onComplete(result.uploadId);
      setImage(null);
      attempt.current = null;
      onPendingChange(false);
      mutation.setNotice("Portrait ready. Save your card to use it.");
    }
  }
  return (
    <div className="form-stack">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">Portrait</h3>
          <p className="muted">Crop an image before adding it to your card.</p>
        </div>
        <input
          ref={input}
          className="sr-only"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          aria-label="Avatar file"
          tabIndex={-1}
          disabled={decoding || mutation.pending}
          onChange={(event) => {
            void choose(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        <Button
          type="button"
          variant="outline"
          disabled={decoding || mutation.pending}
          onClick={() => input.current?.click()}
        >
          <ImagePlus />
          {decoding ? "Opening image…" : "Choose image"}
        </Button>
      </div>
      {image && (
        <div className="form-stack">
          <canvas
            ref={canvas}
            width={512}
            height={512}
            className="avatar-crop-preview"
            role="img"
            aria-label="Cropped portrait preview"
          />
          <div className="avatar-crop-controls">
            {(
              [
                ["zoom", "Zoom", 1, 3, 0.05],
                ["x", "Horizontal position", 0, 100, 1],
                ["y", "Vertical position", 0, 100, 1],
              ] as const
            ).map(([key, label, min, max, step]) => (
              <label key={key} className="form-stack gap-1 text-sm">
                {label}
                <input
                  type="range"
                  min={min}
                  max={max}
                  step={step}
                  value={crop[key]}
                  disabled={mutation.pending}
                  onChange={(event) =>
                    adjust({ ...crop, [key]: Number(event.target.value) })
                  }
                />
              </label>
            ))}
          </div>
          <div className="form-actions">
            <Button
              type="button"
              disabled={mutation.pending}
              onClick={() => void upload()}
            >
              <Upload />
              {mutation.pending
                ? "Uploading…"
                : mutation.error
                  ? "Retry upload"
                  : "Use cropped image"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={mutation.pending}
              onClick={() => {
                setImage(null);
                attempt.current = null;
                onPendingChange(false);
                mutation.setError(null);
              }}
            >
              Cancel crop
            </Button>
          </div>
          <p className="muted">
            Your current portrait stays in place until you save the card.
          </p>
        </div>
      )}
      <MutationFeedback
        {...mutation}
        onReauthenticated={() => mutation.setError(null)}
      />
    </div>
  );
}
