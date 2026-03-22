"use client";

import { trpc } from "../../../lib/trpc";
import { PLATFORM_SPECS } from "@cliphive/shared";
import type { Platform } from "@cliphive/shared";
import { Link2, Link2Off, Users } from "lucide-react";

const PLATFORM_EMOJIS: Record<Platform, string> = {
  tiktok: "🎵",
  instagram: "📸",
  youtube: "▶️",
  twitter: "🐦",
  facebook: "📘",
  snapchat: "👻",
  linkedin: "💼",
  pinterest: "📌",
};

export default function AccountsPage() {
  const { data: accounts, refetch } = trpc.account.list.useQuery();
  const disconnectMutation = trpc.account.disconnect.useMutation({ onSuccess: () => refetch() });

  const connectedMap = new Map(accounts?.map((a) => [a.platform, a]) ?? []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Connected Accounts</h1>
        <p className="text-muted-foreground">
          Connect your social accounts to enable one-click publishing.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {Object.entries(PLATFORM_SPECS).map(([id, spec]) => {
          const platform = id as Platform;
          const account = connectedMap.get(platform);

          return (
            <div
              key={platform}
              className="flex items-center gap-4 rounded-xl border border-border bg-card p-4"
            >
              <div className="text-3xl">{PLATFORM_EMOJIS[platform]}</div>
              <div className="flex-1 min-w-0">
                <p className="font-medium">{spec.name}</p>
                {account ? (
                  <p className="text-xs text-muted-foreground">
                    @{account.username} · {account.followerCount.toLocaleString()} followers
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">Not connected</p>
                )}
              </div>

              {account ? (
                <button
                  onClick={() => disconnectMutation.mutate({ id: account.id })}
                  className="flex items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/10"
                >
                  <Link2Off className="h-3.5 w-3.5" />
                  Disconnect
                </button>
              ) : (
                <a
                  href={`/api/auth/connect/${platform}`}
                  className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
                >
                  <Link2 className="h-3.5 w-3.5" />
                  Connect
                </a>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
