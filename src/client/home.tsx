import { Activity, AlertTriangle, ChevronRight, FolderOpen, Loader2, RefreshCw } from "lucide-react";
import { useState } from "react";
import type { NamespaceConfigSummary } from "../types.ts";
import { Button } from "./components/Button.tsx";
import { Card, CardLink } from "./components/Card.tsx";
import { EmptyState } from "./components/EmptyState.tsx";
import { Layout } from "./components/Layout.tsx";
import { HomeSkeleton } from "./components/Skeleton.tsx";
import { useToast } from "./components/Toast.tsx";
import { useConfigs, useStatus, useUser } from "./hooks.tsx";
import { Link } from "./router.tsx";
import { handleUnauthorized, nsColor } from "./utils.ts";

function NamespaceCard({ ns }: { ns: NamespaceConfigSummary }) {
  const color = nsColor(ns.namespace);
  return (
    <CardLink to={`/${ns.namespace}`} className={`group relative overflow-hidden p-5 border-l-2 ${color.border}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-9 h-9 rounded-lg ${color.bg} flex items-center justify-center shrink-0`}>
            <FolderOpen size={18} className={color.text} />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-neutral-200">{ns.display_name}</h2>
            <span className="inline-flex items-center mt-1 text-[11px] bg-white/[0.04] text-neutral-400 px-1.5 py-0.5 rounded-full font-mono">
              {ns.pipelines.length} pipeline{ns.pipelines.length !== 1 ? "s" : ""}
            </span>
          </div>
        </div>
        <ChevronRight size={16} className="text-neutral-700 group-hover:text-neutral-400 transition-colors" />
      </div>
    </CardLink>
  );
}

export function HomePage() {
  const { data: configs, mutate } = useConfigs();
  const { data: status } = useStatus();
  const [refreshing, setRefreshing] = useState(false);
  const { toast } = useToast();

  const { data: user } = useUser();

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/config/refresh", { method: "POST" });
      handleUnauthorized(res);
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Refresh failed" }));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      await mutate();
      toast("Configs refreshed", "success");
    } catch (err) {
      console.error("Failed to refresh configs:", err);
      toast(err instanceof Error ? err.message : "Failed to refresh configs", "error");
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <Layout
      actions={
        user?.isSuperAdmin ? (
          <Button onClick={handleRefresh} loading={refreshing} icon={<RefreshCw size={14} />}>
            Refresh configs
          </Button>
        ) : undefined
      }
    >
      {!configs ? (
        <HomeSkeleton />
      ) : configs.length === 0 ? (
        <EmptyState
          icon={<FolderOpen size={48} />}
          title="No namespaces configured"
          description="Add TRIGGER_{NS}_CONFIG environment variables to get started."
        />
      ) : (
        <div>
          {status && status.pipelines.length > 0 && (
            <div className="mb-8">
              <div className="flex items-center gap-2 mb-3">
                <Activity size={14} className="text-neutral-400" />
                <h2 className="text-[11px] font-medium text-neutral-500 uppercase tracking-wider">Active Runs</h2>
                <span className="text-[11px] font-mono text-neutral-500">
                  {status.activeRuns}/{status.maxConcurrentRuns}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {status.pipelines.map((p) =>
                  p.runIds.map((runId) => (
                    <Link
                      key={runId}
                      to={`/${p.namespace}/${p.pipelineId}/runs/${runId}`}
                      className="inline-flex items-center gap-2 bg-white/[0.03] border border-white/[0.06] rounded-lg px-3 py-1.5 text-xs no-underline hover:bg-white/[0.06] transition-colors"
                    >
                      <Loader2 size={12} className="text-white animate-spin" />
                      <span className="text-neutral-400">
                        {p.namespace}/{p.pipelineId}
                      </span>
                      <span className="font-mono text-neutral-500">{runId.slice(0, 8)}</span>
                    </Link>
                  )),
                )}
              </div>
            </div>
          )}

          <h1 className="text-xl font-semibold tracking-tight mb-6">Namespaces</h1>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {configs.map((ns) =>
              ns.error ? (
                <Card key={ns.namespace} className="relative overflow-hidden p-4 opacity-50">
                  <div className="absolute top-0 left-0 right-0 h-0.5 bg-red-500/60" />
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-red-500/15 flex items-center justify-center shrink-0">
                      <AlertTriangle size={18} className="text-red-400" />
                    </div>
                    <div className="min-w-0">
                      <h2 className="text-sm font-semibold text-neutral-400">{ns.display_name}</h2>
                      <p className="text-xs text-red-400/80 truncate" title={ns.error}>
                        Config failed to load
                      </p>
                    </div>
                  </div>
                </Card>
              ) : (
                <NamespaceCard key={ns.namespace} ns={ns} />
              ),
            )}
          </div>
        </div>
      )}
    </Layout>
  );
}
