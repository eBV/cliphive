"use client";

import { Bell, Search } from "lucide-react";

export function TopNav() {
  return (
    <header className="flex h-14 items-center gap-4 border-b border-border bg-card px-4">
      {/* Search */}
      <div className="flex flex-1 items-center gap-2 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-muted-foreground">
        <Search className="h-4 w-4" />
        <span>Search clips, sources…</span>
      </div>

      <div className="flex items-center gap-3">
        {/* Notifications */}
        <button className="relative flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent">
          <Bell className="h-4 w-4" />
          <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-primary" />
        </button>

        {/* Avatar */}
        <div className="h-8 w-8 rounded-full bg-primary/20 ring-2 ring-primary/40" />
      </div>
    </header>
  );
}
