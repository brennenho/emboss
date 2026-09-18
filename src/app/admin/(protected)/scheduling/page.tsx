import { pageOwner } from "@/server/runtime";
import { readScheduling } from "@/server/configuration-store";
import { config } from "@/server/config";
import { SchedulingWorkspace } from "@/features/scheduling/scheduling-workspace";
export default async function Page() {
  const { env } = await pageOwner();
  const data = await readScheduling(env);
  return (
    <SchedulingWorkspace
      key={data.revision}
      data={data}
      origin={config(env).origin}
    />
  );
}
