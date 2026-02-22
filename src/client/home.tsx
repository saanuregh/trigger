import { AlertTriangle, FolderOpen, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { NamespaceConfigSummary, PaginatedResponse, RunRow } from "../types.ts";
import { EmptyState } from "./components/EmptyState.tsx";
import { Layout } from "./components/Layout.tsx";
import { SectionHeader } from "./components/SectionHeader.tsx";
import { HomeSkeleton } from "./components/Skeleton.tsx";
import { StatusDot } from "./components/StatusBadge.tsx";
import { useConfigs, useFetch } from "./hooks.tsx";
import { FocusList, focusRingClass } from "./keyboard.tsx";
import { Link, navigate } from "./router.tsx";
import { nsColor, timeAgo } from "./utils.ts";
import { useGlobalEvents, useStatus } from "./ws.tsx";

function NamespaceRow({
  ns,
  focused,
  activeRuns,
  lastRun,
}: {
  ns: NamespaceConfigSummary;
  focused: boolean;
  activeRuns: number;
  lastRun: RunRow | null;
}) {
  const color = nsColor(ns.namespace);
  return (
    <Link
      to={`/${ns.namespace}`}
      className={`flex items-center gap-3 px-3 py-1.5 hover:bg-white/[0.04] transition-colors no-underline group ${focusRingClass(focused)}`}
    >
      <span className={`w-2 h-2 rounded-full ${color.dot} shrink-0`} />
      <span className="text-sm text-neutral-200 group-hover:text-white font-medium truncate">{ns.display_name}</span>
      <span className="text-xs text-neutral-600 font-mono shrink-0">{ns.pipelines.length}p</span>
      <span className="flex-1" />
      {activeRuns > 0 && (
        <span className="flex items-center gap-1 text-xs text-white shrink-0">
          <Loader2 size={10} className="animate-spin" />
          {activeRuns}
        </span>
      )}
      {lastRun && (
        <span className="flex items-center gap-1.5 shrink-0">
          <StatusDot status={lastRun.status} />
          <span className="text-xs text-neutral-600 font-mono whitespace-nowrap">{timeAgo(lastRun.started_at)}</span>
        </span>
      )}
    </Link>
  );
}

function ConfigErrors({ configs }: { configs: NamespaceConfigSummary[] }) {
  if (configs.length === 0) return null;
  return (
    <div className="mb-4 space-y-2">
      {configs.map((ns) => (
        <div key={ns.namespace} className="flex items-start gap-2.5 bg-red-500/[0.08] border border-red-500/15 rounded-lg px-3 py-2">
          <AlertTriangle size={14} className="text-red-400 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <span className="text-sm text-red-300 font-medium">{ns.display_name ?? ns.namespace}</span>
            <p className="text-xs text-red-400/80 mt-0.5 break-all">{ns.error}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function ActivityFeed({ runs }: { runs: RunRow[] }) {
  return (
    <div>
      <SectionHeader className="mb-2">Recent Activity</SectionHeader>
      {runs.length === 0 ? (
        <div className="text-xs text-neutral-600 py-4">No recent activity</div>
      ) : (
        <div className="bg-neutral-900/50 border border-white/[0.06] rounded-lg overflow-hidden divide-y divide-white/[0.04]">
          {runs.slice(0, 20).map((run) => (
            <Link
              key={run.id}
              to={`/${run.namespace}/${run.pipeline_id}/runs/${run.id}`}
              className="flex items-center gap-3 px-3 py-1.5 text-sm hover:bg-white/[0.04] transition-colors no-underline"
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
      )}
    </div>
  );
}

export function HomePage() {
  const { data: configs } = useConfigs();
  const { data: status } = useStatus();
  const { data: recentData, mutate: mutateRecent } = useFetch<PaginatedResponse<RunRow>>("/api/runs?per_page=100");

  // Debounce refetches — multiple events in quick succession coalesce into one API call
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const debouncedMutate = useCallback(
    (_event: unknown) => {
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => mutateRecent(), 500);
    },
    [mutateRecent],
  );

  useGlobalEvents(debouncedMutate);

  useEffect(() => {
    return () => clearTimeout(debounceRef.current);
  }, []);

  const validConfigs = useMemo(() => configs?.filter((c) => !c.error) ?? [], [configs]);
  const errorConfigs = useMemo(() => configs?.filter((c) => c.error) ?? [], [configs]);

  // Active runs per namespace from WebSocket status
  const activeByNs = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of status?.pipelines ?? []) {
      map.set(p.namespace, (map.get(p.namespace) ?? 0) + p.runIds.length);
    }
    return map;
  }, [status]);

  // Last run per namespace from recent runs
  const lastRunByNs = useMemo(() => {
    const map = new Map<string, RunRow>();
    for (const run of recentData?.data ?? []) {
      if (!map.has(run.namespace)) map.set(run.namespace, run);
    }
    return map;
  }, [recentData]);

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
        <>
          <ConfigErrors configs={errorConfigs} />
          <div className="flex flex-col lg:flex-row gap-6">
            {/* Namespaces — left column */}
            <div className="w-full lg:w-80 lg:shrink-0">
              <SectionHeader className="mb-2">Namespaces</SectionHeader>
              <FocusList
                items={validConfigs}
                onSelect={(ns) => navigate(`/${ns.namespace}`)}
                className="bg-neutral-900/50 border border-white/[0.06] rounded-lg overflow-hidden divide-y divide-white/[0.04]"
              >
                {(ns, focused) => (
                  <NamespaceRow
                    key={ns.namespace}
                    ns={ns}
                    focused={focused}
                    activeRuns={activeByNs.get(ns.namespace) ?? 0}
                    lastRun={lastRunByNs.get(ns.namespace) ?? null}
                  />
                )}
              </FocusList>
            </div>

            {/* Activity — right column */}
            <div className="flex-1 min-w-0">
              <ActivityFeed runs={recentData?.data ?? []} />
            </div>
          </div>
        </>
      )}
    </Layout>
  );
}
