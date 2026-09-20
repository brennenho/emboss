// A response acknowledges the submitted snapshot, not edits made in flight.
export function mergeSavedDraft<T extends object>(
  current: T,
  submitted: T,
  saved: T,
): T {
  const merged = { ...current };
  for (const key of Object.keys(saved) as (keyof T)[]) {
    if (JSON.stringify(current[key]) === JSON.stringify(submitted[key]))
      merged[key] = saved[key];
  }
  return merged;
}
