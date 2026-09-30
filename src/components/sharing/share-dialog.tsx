"use client";
import { useEffect, useState } from "react";
import type { ComponentProps } from "react";
import Image from "next/image";
import { Copy, ExternalLink, QrCode, Check, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function sharingDescription(state: string) {
  if (state === "active") return "Anyone with the link can open it.";
  if (state === "expired")
    return "This link has expired. Change its expiry before sharing it again.";
  if (state === "disabled")
    return "This link is paused. Publish it again before sharing it.";
  return "Only you can open this until you publish it.";
}

export function CopyButton({
  value,
  label = "Copy link",
  showLabel = false,
  variant = "ghost",
}: {
  value: string;
  label?: string;
  showLabel?: boolean;
  variant?: ComponentProps<typeof Button>["variant"];
}) {
  const [status, setStatus] = useState("");
  const copied = status === "Copied";
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setStatus(""), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <span className="copy-control" data-copied={copied || undefined}>
      <Button
        className="copy-button"
        variant={variant}
        size={showLabel || copied ? "default" : "icon"}
        type="button"
        aria-label={copied ? "Copied" : label}
        title={copied ? "Copied" : label}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setStatus("Copied");
          } catch {
            setStatus("Could not copy. Select and copy the address.");
          }
        }}
      >
        {copied ? <Check /> : <Copy />}
        {(showLabel || copied) && <span>{copied ? "Copied" : label}</span>}
      </Button>
      <span
        role="status"
        className={!status || copied ? "sr-only" : "copy-error"}
      >
        {status}
      </span>
    </span>
  );
}

export function AddressPlate({ url }: { url: string }) {
  return (
    <div className="address-plate">
      <code className="address-value">{url}</code>
      <CopyButton value={url} showLabel />
    </div>
  );
}

function qrFilename(url: string) {
  const address = new URL(url);
  return `emboss-${`${address.hostname}${address.pathname}`.replace(/[^a-z0-9_-]+/gi, "-").replace(/-+$/, "")}-qr`;
}

function QrExport({ url }: { url: string }) {
  const [png, setPng] = useState("");
  const [svg, setSvg] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    void import("qrcode")
      .then(async ({ default: qr }) => {
        const options = { errorCorrectionLevel: "M" as const, margin: 4 };
        const code = qr.create(url, options);
        const scale = Math.ceil(1024 / (code.modules.size + 8));
        const [pngData, svgData] = await Promise.all([
          qr.toDataURL(url, { ...options, scale }),
          qr.toString(url, { ...options, type: "svg" }),
        ]);
        if (!cancelled) {
          setPng(pngData);
          setSvg(svgData);
        }
      })
      .catch(() => {
        if (!cancelled)
          setError(
            "Could not create the QR code. Close and reopen this section to retry.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [url]);
  const filename = qrFilename(url);
  function downloadSvg() {
    const object = URL.createObjectURL(
      new Blob([svg], { type: "image/svg+xml" }),
    );
    const a = document.createElement("a");
    a.href = object;
    a.download = `${filename}.svg`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(object), 1000);
  }
  return (
    <div className="qr-export">
      <div className="qr-preview">
        {png ? (
          <Image
            unoptimized
            src={png}
            width={208}
            height={208}
            alt={`QR code for ${url}`}
          />
        ) : (
          <p role="status">{error || "Generating QR code…"}</p>
        )}
      </div>
      <div className="form-actions">
        <Button
          type="button"
          variant="outline"
          disabled={!svg}
          onClick={downloadSvg}
        >
          Download SVG
        </Button>
        {png ? (
          <Button variant="outline" asChild>
            <a href={png} download={`${filename}.png`}>
              Download PNG
            </a>
          </Button>
        ) : (
          <Button type="button" variant="outline" disabled>
            Download PNG
          </Button>
        )}
      </div>
      <p className="muted">
        The QR code uses this address. You can update the content without
        printing a new code.
      </p>
    </div>
  );
}

export function ShareDialog({
  url,
  state,
  title = "Share link",
  disabled = false,
}: {
  url: string;
  state: string;
  title?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [canShare, setCanShare] = useState(false);
  const [error, setError] = useState("");
  async function nativeShare() {
    try {
      await navigator.share({ url, title });
      setError("");
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      setError("Could not open sharing. You can copy the link instead.");
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        setCanShare(typeof navigator.share === "function");
        if (!nextOpen) {
          setQrOpen(false);
          setError("");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" disabled={disabled}>
          <Share2 />
          Share
        </Button>
      </DialogTrigger>
      <DialogContent className="share-dialog sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{sharingDescription(state)}</DialogDescription>
        </DialogHeader>
        <AddressPlate url={url} />
        <div className="form-actions">
          {canShare && (
            <Button
              type="button"
              variant="outline"
              onClick={() => void nativeShare()}
            >
              <Share2 />
              Share with…
            </Button>
          )}
          {state === "active" && (
            <Button variant="ghost" asChild>
              <a href={url} target="_blank" rel="noreferrer">
                Open link
                <ExternalLink />
              </a>
            </Button>
          )}
        </div>
        {error && (
          <p role="status" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <details
          className="sharing-options"
          open={qrOpen}
          onToggle={(event) => setQrOpen(event.currentTarget.open)}
        >
          <summary>
            <QrCode size={16} />
            QR code
          </summary>
          {qrOpen && <QrExport key={url} url={url} />}
        </details>
      </DialogContent>
    </Dialog>
  );
}
