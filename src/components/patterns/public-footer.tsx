import { bindings } from "@/server/runtime";
export async function PublicFooter() {
  const row = await bindings()
    .DB.prepare("SELECT show_powered_by FROM installation WHERE id=1")
    .first<{ show_powered_by: number }>();
  return row?.show_powered_by ? (
    <footer className="text-muted-foreground pb-8 text-center text-xs">
      Powered by Emboss
    </footer>
  ) : null;
}
