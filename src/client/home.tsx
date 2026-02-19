import { AlertTriangle, ChevronRight, FolderOpen, Loader2 } from "lucide-react";
import type { NamespaceConfigSummary, PaginatedResponse, RunRow } from "../types.ts";
import { Card, CardLink } from "./components/Card.tsx";
import { EmptyState } from "./components/EmptyState.tsx";
import { Layout } from "./components/Layout.tsx";
import { HomeSkeleton } from "./components/Skeleton.tsx";
import { StatusDot } from "./components/StatusBadge.tsx";
import { useConfigs, useFetch } from "./hooks.tsx";
import { Link } from "./router.tsx";
import { nsColor, timeAgo } from "./utils.ts";
import { useGlobalEvents, useStatus } from "./ws.tsx";

function NamespaceCard({ ns, activeRuns, lastRun }: { ns: NamespaceConfigSummary; activeRuns: number; lastRun: RunRow | null }) {
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
      <div className="flex items-center gap-3 mt-3 pt-3 border-t border-white/[0.04] text-[11px]">
        {activeRuns > 0 ? (
          <span className="flex items-center gap-1.5 text-white">
            <Loader2 size={10} className="animate-spin" />
            {activeRuns} running
          </span>
        ) : (
          <span className="text-neutral-600">idle</span>
        )}
        {lastRun && (
          <span className="flex items-center gap-1.5 ml-auto">
            <StatusDot status={lastRun.status} />
            <span className="text-neutral-600">{timeAgo(lastRun.started_at)}</span>
          </span>
        )}
      </div>
    </CardLink>
  );
}

function ActivityFeed({ runs }: { runs: RunRow[] }) {
  if (runs.length === 0) return null;

  return (
    <div className="mt-8">
      <h2 className="text-[11px] font-medium text-neutral-500 uppercase tracking-wider mb-3">Recent Activity</h2>
      <div className="bg-neutral-900/50 border border-white/[0.06] rounded-xl overflow-hidden divide-y divide-white/[0.04]">
        {runs.slice(0, 15).map((run) => (
          <Link
            key={run.id}
            to={`/${run.namespace}/${run.pipeline_id}/runs/${run.id}`}
            className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-white/[0.04] transition-colors no-underline"
          >
            <StatusDot status={run.status} />
            <span className="text-neutral-400 min-w-0 flex-1 truncate">
              <span className="text-neutral-500">{run.namespace}/</span>
              <span className="text-neutral-200">{run.pipeline_name}</span>
            </span>
            <span className="text-xs text-neutral-600 shrink-0">{run.triggered_by || ""}</span>
            <span className="text-xs text-neutral-600 shrink-0 font-mono" title={run.started_at}>
              {timeAgo(run.started_at)}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function HomePage() {
  const { data: configs } = useConfigs();
  const { data: status } = useStatus();
  const { data: recentData, mutate: mutateRecent } = useFetch<PaginatedResponse<RunRow>>("/api/runs?per_page=100");

  useGlobalEvents(() => mutateRecent());

  // Active runs per namespace from WebSocket status
  const activeByNs = new Map<string, number>();
  for (const p of status?.pipelines ?? []) {
    activeByNs.set(p.namespace, (activeByNs.get(p.namespace) ?? 0) + p.runIds.length);
  }

  // Last run per namespace from recent runs
  const lastRunByNs = new Map<string, RunRow>();
  for (const run of recentData?.data ?? []) {
    if (!lastRunByNs.has(run.namespace)) lastRunByNs.set(run.namespace, run);
  }

  return (
    <Layout>
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
                <NamespaceCard
                  key={ns.namespace}
                  ns={ns}
                  activeRuns={activeByNs.get(ns.namespace) ?? 0}
                  lastRun={lastRunByNs.get(ns.namespace) ?? null}
                />
              ),
            )}
          </div>
          <ActivityFeed runs={recentData?.data ?? []} />
        </div>
      )}
    </Layout>
  );
}
