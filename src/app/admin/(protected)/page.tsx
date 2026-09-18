import { redirect } from "next/navigation";
import { pageOwner } from "@/server/runtime";
export default async function Admin() {
  await pageOwner();
  redirect("/admin/links");
}
