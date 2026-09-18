"use client";
import { Button } from "@/components/ui/button";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="empty-state">
      <h1>Could not load this workspace</h1>
      <p className="my-4">Check your connection and try again.</p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
