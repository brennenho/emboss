import Image from "next/image";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? "brand-compact" : ""}`}>
      <Image src="/icon.svg" width={32} height={32} alt="" unoptimized />
      <span>Emboss</span>
    </div>
  );
}
