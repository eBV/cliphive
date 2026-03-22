"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "../../lib/utils";
import {
  LayoutDashboard,
  Upload,
  Film,
  Layers,
  Send,
  BarChart3,
  TrendingUp,
  Users,
  Settings,
  Zap,
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/", icon: LayoutDashboard, label: "Dashboard" },
  { href: "/upload", icon: Upload, label: "Upload" },
  { href: "/sources", icon: Film, label: "Sources" },
  { href: "/clips", icon: Zap, label: "Clips" },
  { href: "/templates", icon: Layers, label: "Templates" },
  { href: "/publish", icon: Send, label: "Publish" },
  { href: "/analytics", icon: BarChart3, label: "Analytics" },
  { href: "/trending", icon: TrendingUp, label: "Trending" },
  { href: "/accounts", icon: Users, label: "Accounts" },
  { href: "/settings", icon: Settings, label: "Settings" },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-full w-16 flex-col items-center border-r border-border bg-card py-4 md:w-56 md:items-start">
      {/* Logo */}
      <div className="mb-6 px-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
            <Zap className="h-4 w-4 text-white" />
          </div>
          <span className="hidden text-lg font-bold md:block">ClipHive</span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex flex-1 flex-col gap-1 px-2 w-full">
        {NAV_ITEMS.map(({ href, icon: Icon, label }) => {
          const active = pathname === href || (href !== "/" && pathname.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-2 py-2 text-sm font-medium transition-colors",
                "hover:bg-accent hover:text-accent-foreground",
                active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground"
              )}
            >
              <Icon className="h-4 w-4 flex-shrink-0" />
              <span className="hidden md:block">{label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
