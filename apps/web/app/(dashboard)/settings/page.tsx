"use client";

import { useState } from "react";
import { trpc } from "../../../lib/trpc";
import { Key, Copy, RefreshCw, Check } from "lucide-react";

export default function SettingsPage() {
  const { data: user } = trpc.user.getMe.useQuery();
  const generateKeyMutation = trpc.user.generateApiKey.useMutation();
  const revokeKeyMutation = trpc.user.revokeApiKey.useMutation();
  const [copied, setCopied] = useState(false);

  function copyKey() {
    if (user?.apiKey) {
      navigator.clipboard.writeText(user.apiKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
      </div>

      {/* Profile */}
      <section className="rounded-xl border border-border bg-card p-6 space-y-4">
        <h2 className="font-semibold">Profile</h2>
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 rounded-full bg-primary/20 ring-2 ring-primary/40 overflow-hidden">
            {user?.avatarUrl && (
              <img src={user.avatarUrl} alt={user.name ?? ""} className="h-full w-full object-cover" />
            )}
          </div>
          <div>
            <p className="font-medium">{user?.name ?? "—"}</p>
            <p className="text-sm text-muted-foreground">{user?.email}</p>
            <span className="mt-1 inline-block rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary capitalize">
              {user?.plan ?? "free"} plan
            </span>
          </div>
        </div>
      </section>

      {/* API Key */}
      <section className="rounded-xl border border-border bg-card p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Key className="h-5 w-5 text-muted-foreground" />
          <h2 className="font-semibold">API Key</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Use this key to access ClipHive via the headless API.
        </p>

        {user?.apiKey ? (
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono truncate">
              {user.apiKey}
            </code>
            <button
              onClick={copyKey}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs hover:bg-accent"
            >
              {copied ? <Check className="h-4 w-4 text-green-400" /> : <Copy className="h-4 w-4" />}
            </button>
            <button
              onClick={() => revokeKeyMutation.mutate()}
              className="flex items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-2 text-xs text-red-400 hover:bg-red-500/10"
            >
              Revoke
            </button>
          </div>
        ) : (
          <button
            onClick={() => generateKeyMutation.mutate()}
            disabled={generateKeyMutation.isPending}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${generateKeyMutation.isPending ? "animate-spin" : ""}`} />
            Generate API Key
          </button>
        )}
      </section>
    </div>
  );
}
