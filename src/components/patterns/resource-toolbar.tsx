"use client";
import { EditorReady } from "@/components/patterns/editor-ready";
import { useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { statusLabel } from "./resource-controls";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function ResourceToolbar({
  kind,
  query,
  state,
  onSearch,
  onFilter,
  compact = false,
}: {
  kind: "links" | "pastes" | "files";
  query: string;
  state?: string;
  onSearch: (query: string) => void;
  onFilter?: (state: string) => void;
  compact?: boolean;
}) {
  const [search, setSearch] = useState(query);
  return (
    <EditorReady>
      <form
        className="resource-toolbar"
        data-compact={compact || undefined}
        data-search-only={!onFilter || undefined}
        role="search"
        aria-label={`${kind} filters`}
        onSubmit={(event) => {
          event.preventDefault();
          onSearch(search);
        }}
      >
        <div className="search-input">
          <Search aria-hidden="true" size={15} />
          <Input
            className="pl-8"
            aria-label={`Search ${kind}`}
            placeholder={`Search ${kind}`}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            maxLength={200}
          />
        </div>
        <Button variant="outline" type="submit">
          Search
        </Button>
        {onFilter && (
          <Select value={state} onValueChange={onFilter}>
            <SelectTrigger
              aria-label={`Filter ${kind}`}
              className="state-filter w-full"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["all", "active", "draft", "disabled", "expired"].map(
                (value) => (
                  <SelectItem key={value} value={value}>
                    {value === "all" ? "All states" : statusLabel(value)}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
        )}
      </form>
    </EditorReady>
  );
}
