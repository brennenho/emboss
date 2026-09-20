import { pageOwner } from "@/server/runtime";
import { readScheduling } from "@/server/configuration-store";
import { config } from "@/server/config";
import { SchedulingWorkspace } from "@/features/scheduling/scheduling-workspace";
export const metadata = { title: "Scheduling" };
export default async function Page() {
  const { env } = await pageOwner();
  const data = await readScheduling(env);
  return <SchedulingWorkspace data={data} origin={config(env).origin} />;
}
