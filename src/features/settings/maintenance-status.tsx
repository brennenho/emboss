import { LocalTime } from "@/components/patterns/local-time";
import { formatBytes } from "@/shared/format";
import type { MaintenanceHealth } from "@/server/maintenance/health";

export function MaintenanceStatus({
  health,
  readOnly,
}: {
  health: MaintenanceHealth;
  readOnly: boolean;
}) {
  const needsAttention =
    !readOnly && (health.stale || health.overdue || health.failureCount > 0);
  const status = readOnly
    ? "Paused for maintenance"
    : needsAttention
      ? "Needs attention"
      : !health.startedAt
        ? "No cleanup recorded yet"
        : !health.finishedAt
          ? "Cleanup in progress"
          : "Last cleanup completed";
  return (
    <section className="form-stack" aria-labelledby="cleanup-title">
      <div>
        <h3 id="cleanup-title">Automatic cleanup</h3>
        <p
          className={needsAttention ? "text-destructive text-sm" : "muted"}
          role={needsAttention ? "status" : undefined}
        >
          {status}
        </p>
      </div>
      <p className="muted">
        Runs hourly. Removes content after its recovery deadline and frees
        retained file storage.
      </p>
      <dl className="data-list">
        <div className="flex flex-wrap justify-between gap-2">
          <dt>Last started</dt>
          <dd>
            {health.startedAt ? (
              <LocalTime value={health.startedAt} />
            ) : (
              "Not recorded"
            )}
          </dd>
        </div>
        <div className="flex flex-wrap justify-between gap-2">
          <dt>Last completed without errors</dt>
          <dd>
            {health.succeededAt ? (
              <LocalTime value={health.succeededAt} />
            ) : (
              "Not recorded"
            )}
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>Cleanup tasks waiting</dt>
          <dd>
            {health.pendingCount} · {health.dueCount} due now
          </dd>
        </div>
        {health.oldestPendingAt && (
          <div className="flex flex-wrap justify-between gap-2">
            <dt>Oldest waiting task</dt>
            <dd>
              <LocalTime value={health.oldestPendingAt} />
            </dd>
          </div>
        )}
        <div className="flex justify-between gap-2">
          <dt>Storage reclaimed last run</dt>
          <dd>{formatBytes(health.reclaimedBytes)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>Storage reclaimed since tracking began</dt>
          <dd>{formatBytes(health.totalReclaimedBytes)}</dd>
        </div>
      </dl>
      {health.stale && !readOnly && (
        <p className="muted">
          No completed cleanup in the past two hours. Check the scheduled
          Worker.
        </p>
      )}
      {health.overdue && !readOnly && (
        <p className="muted">
          Some cleanup tasks are more than two hours overdue. Retained files
          still count toward storage.
        </p>
      )}
      {health.failureCount > 0 && (
        <div className="form-stack">
          <p className="muted">
            {health.failureCount}{" "}
            {health.failureCount === 1
              ? "operation failed"
              : "operations failed"}{" "}
            during the last run. Unfinished cleanup will retry automatically.
          </p>
          <details>
            <summary className="cursor-pointer text-sm">
              Failure references
            </summary>
            <p className="muted mt-2 break-all">
              Run: <code>{health.runId}</code>
            </p>
            <ul className="mt-2 space-y-1 font-mono text-xs break-all">
              {health.failures.map((failure, index) => (
                <li key={index}>
                  {failure.operation}
                  {failure.id ? ` · ${failure.id}` : ""}
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </section>
  );
}
