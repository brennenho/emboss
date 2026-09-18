"use client";
import { useSyncExternalStore } from "react";
const subscribe = () => () => {};
export function LocalTime({
  value,
  dateOnly = false,
}: {
  value: string;
  dateOnly?: boolean;
}) {
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const date = new Date(value);
  const text = hydrated
    ? new Intl.DateTimeFormat(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        ...(dateOnly
          ? {}
          : { hour: "numeric", minute: "2-digit", timeZoneName: "short" }),
      }).format(date)
    : value.slice(0, dateOnly ? 10 : 16).replace("T", " ") +
      (dateOnly ? "" : " UTC");
  return (
    <time dateTime={value} title={value}>
      {text}
    </time>
  );
}
