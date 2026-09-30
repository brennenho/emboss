import type { Env } from "../config";

export type MaintenanceFailure = { operation: string; id?: string };
export type MaintenanceHealth = {
  runId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  succeededAt: string | null;
  failureCount: number;
  failures: MaintenanceFailure[];
  reclaimedBytes: number;
  totalReclaimedBytes: number;
  pendingCount: number;
  dueCount: number;
  oldestPendingAt: string | null;
  stale: boolean;
  overdue: boolean;
};

type HealthRow = {
  run_id: string;
  started_at: number;
  finished_at: number | null;
  succeeded_at: number | null;
  failure_count: number;
  failures: string;
  reclaimed_bytes: number;
  total_reclaimed_bytes: number;
};
const iso = (value: number | null | undefined) =>
  value == null ? null : new Date(value).toISOString();

export async function readMaintenanceHealth(
  env: Env,
  now = Date.now(),
): Promise<MaintenanceHealth> {
  const [run, queue] = await Promise.all([
    env.DB.prepare(
      "SELECT * FROM maintenance_health WHERE id=1",
    ).first<HealthRow>(),
    env.DB.prepare(
      `SELECT COUNT(*) pending_count,
        COALESCE(SUM(CASE WHEN due_at<=? THEN 1 ELSE 0 END),0) due_count,
        MIN(queued_at) oldest_pending_at,
        MIN(due_at) oldest_due_at
      FROM (
        SELECT updated_at queued_at,purge_after due_at FROM blobs WHERE state='pending_delete'
        UNION ALL
        SELECT deleted_at queued_at,purge_after due_at FROM resources
          WHERE state='deleted' AND purged_at IS NULL
      )`,
    )
      .bind(now)
      .first<{
        pending_count: number;
        due_count: number;
        oldest_pending_at: number | null;
        oldest_due_at: number | null;
      }>(),
  ]);
  // Cron runs hourly. Two missed intervals deserve attention; retained content
  // whose deadline is still ahead is expected, not an unhealthy backlog.
  const warningAfter = 2 * 60 * 60 * 1000;
  return {
    runId: run?.run_id ?? null,
    startedAt: iso(run?.started_at),
    finishedAt: iso(run?.finished_at),
    succeededAt: iso(run?.succeeded_at),
    failureCount: run?.failure_count ?? 0,
    failures: run ? (JSON.parse(run.failures) as MaintenanceFailure[]) : [],
    reclaimedBytes: run?.reclaimed_bytes ?? 0,
    totalReclaimedBytes: run?.total_reclaimed_bytes ?? 0,
    pendingCount: queue?.pending_count ?? 0,
    dueCount: queue?.due_count ?? 0,
    oldestPendingAt: iso(queue?.oldest_pending_at),
    stale: !!run && now - (run.finished_at ?? run.started_at) > warningAfter,
    overdue:
      queue?.oldest_due_at != null && now - queue.oldest_due_at > warningAfter,
  };
}
