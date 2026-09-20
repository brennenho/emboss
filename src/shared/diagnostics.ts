// Return only fixed classifications. Messages may contain SQL, credentials,
// object names, or user content and must never be emitted to request logs.
export function failureCategory(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/D1_ERROR|SQLITE_|D1_EXEC_ERROR/i.test(message)) return "database";
  if (/R2_ERROR|R2 (?:GET|PUT|HEAD|DELETE)|Object storage/i.test(message))
    return "storage";
  if (/timeout|timed out|ECONN|ENOTFOUND|fetch failed/i.test(message))
    return "network";
  if (error instanceof TypeError) return "type";
  if (error instanceof SyntaxError) return "syntax";
  if (error instanceof RangeError) return "range";
  return "unexpected";
}

export function operatorFailureHint(stderr: string): string {
  if (/authentication|unauthorized|forbidden|\b10000\b|\b9109\b/i.test(stderr))
    return "Check Cloudflare sign-in and token permissions for the selected target.";
  if (/not found|does not exist|could not find/i.test(stderr))
    return "Check the selected target's database, bucket, and binding configuration.";
  if (/SQLITE_|D1_ERROR|D1_EXEC_ERROR/i.test(stderr))
    return "D1 rejected the operation. Check the target schema and migration version.";
  if (/timeout|timed out|ECONN|ENOTFOUND|fetch failed/i.test(stderr))
    return "Check network connectivity and Cloudflare service status before retrying.";
  if (/quota|limit exceeded|too many requests|\b429\b/i.test(stderr))
    return "The target reached a rate or storage limit. Check its usage before retrying.";
  return "Check the selected target and Wrangler's local diagnostic log. Diagnostic logs may contain sensitive data.";
}
