import { PublicFooter } from "@/components/patterns/public-footer";
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <PublicFooter />
    </>
  );
}
