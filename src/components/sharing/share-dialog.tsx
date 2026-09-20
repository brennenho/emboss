"use client";
import { useEffect, useState } from "react";
import Image from "next/image";
import { Copy, ExternalLink, QrCode, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
export function CopyButton({
  value,
  label = "Copy address",
}: {
  value: string;
  label?: string;
}) {
  const [status, setStatus] = useState("");
  useEffect(() => {
    if (status !== "Copied") return;
    const timer = window.setTimeout(() => setStatus(""), 2000);
    return () => window.clearTimeout(timer);
  }, [status]);
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        type="button"
        aria-label={label}
        title={label}
        onClick={() => {
          if (!navigator.clipboard) {
            setStatus("Could not copy. Select and copy the text.");
            return;
          }
          void navigator.clipboard
            .writeText(value)
            .then(() => setStatus("Copied"))
            .catch(() =>
              setStatus("Could not copy. Select and copy the text."),
            );
        }}
      >
        {status === "Copied" ? <Check /> : <Copy />}
      </Button>
      <span
        role="status"
        className={!status || status === "Copied" ? "sr-only" : "copy-error"}
      >
        {status}
      </span>
    </>
  );
}
export function AddressPlate({ url }: { url: string }) {
  return (
    <div className="address-plate">
      <code className="address-value">{url}</code>
      <CopyButton value={url} />
    </div>
  );
}
export function ShareDialog({
  url,
  state,
  title = "Share address",
  disabled = false,
}: {
  url: string;
  state: string;
  title?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false),
    [png, setPng] = useState(""),
    [svg, setSvg] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
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
          setError("");
        }
      })
      .catch(() => {
        if (!cancelled)
          setError(
            "Could not create the QR code. Reopen this dialog to retry.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [url, open]);
  function downloadSvg() {
    const object = URL.createObjectURL(
      new Blob([svg], { type: "image/svg+xml" }),
    );
    const a = document.createElement("a");
    a.href = object;
    a.download = "emboss-qr.svg";
    a.click();
    setTimeout(() => URL.revokeObjectURL(object), 1000);
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" disabled={disabled}>
          <QrCode />
          Share
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {state === "active"
              ? "Anyone with this address can open it."
              : `Not public · ${state}`}
          </DialogDescription>
        </DialogHeader>
        <AddressPlate url={url} />
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="text-primary inline-flex items-center gap-2 text-sm"
        >
          Open address
          <ExternalLink size={14} />
        </a>
        <div className="border-border grid min-h-56 place-items-center border bg-white p-4">
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
          <Button variant="outline" disabled={!png} asChild>
            <a
              href={png || undefined}
              download="emboss-qr.png"
              aria-disabled={!png}
            >
              Download PNG
            </a>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
