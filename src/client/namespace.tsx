import { Clock, GitBranch, Loader2, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PaginatedResponse, PipelineDefSummary, RunRow } from "../types.ts";
import { EmptyState } from "./components/EmptyState.tsx";
import { ErrorMessage } from "./components/ErrorMessage.tsx";
import { Layout } from "./components/Layout.tsx";
import { NamespaceNav } from "./components/NamespaceNav.tsx";
import { SectionHeader } from "./components/SectionHeader.tsx";
import { NamespaceSkeleton } from "./components/Skeleton.tsx";
import { StatusDot } from "./components/StatusBadge.tsx";
import { useConfigs, useFetch } from "./hooks.tsx";
import { FocusList, focusRingClass, useKeyboard } from "./keyboard.tsx";
import { Link, navigate, useRoute } from "./router.tsx";
import { formatDuration, timeAgo } from "./utils.ts";
import { useGlobalEvents, useStatus } from "./ws.tsx";

function PipelineRow({
  ns,
  pipeline,
  focused,
  lastRun,
  activeRuns,
}: {
  ns: string;
  pipeline: PipelineDefSummary;
  focused: boolean;
  lastRun: RunRow | undefined;
  activeRuns: number;
}) {
  return (
    <Link
      to={`/${ns}/${pipeline.id}`}
      className={`flex items-center gap-3 px-3 py-1.5 hover:bg-white/[0.04] transition-colors no-underline ${focusRingClass(focused)}`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm text-neutral-200 font-medium truncate">{pipeline.name}</span>
          <span className="text-[11px] text-neutral-600 font-mono shrink-0">{pipeline.steps.length}s</span>
          {activeRuns > 0 && (
            <span className="flex items-center gap-1 text-xs text-white shrink-0">
              <Loader2 size={10} className="animate-spin" />
              {activeRuns}
            </span>
          )}
          {pipeline.schedule && (
            <span title="Scheduled" className="text-neutral-500 shrink-0">
              <Clock size={12} />
            </span>
          )}
        </div>
        {pipeline.description && <div className="text-xs text-neutral-500 mt-0.5 truncate">{pipeline.description}</div>}
      </div>
      <span className="shrink-0 w-[68px] flex items-center">
        {lastRun ? <StatusDot status={lastRun.status} /> : <span className="text-xs text-neutral-600">-</span>}
      </span>
      <span className="text-xs text-neutral-500 shrink-0 w-16">
        {lastRun ? (
          <span title={`${lastRun.started_at}${lastRun.triggered_by ? ` by ${lastRun.triggered_by}` : ""}`}>
            {timeAgo(lastRun.started_at)}
          </span>
        ) : (
          <span className="text-neutral-600">-</span>
        )}
      </span>
      <span className="text-xs text-neutral-500 font-mono shrink-0 w-12">
        {lastRun?.finished_at ? formatDuration(lastRun.started_at, lastRun.finished_at) : lastRun ? "..." : "-"}
      </span>
    </Link>
  );
}

export function NamespacePage() {
  const { ns } = useRoute().params as { ns: string };
  const [filter, setFilter] = useState("");
  const filterRef = useRef<HTMLInputElement>(null);

  const { data: configs, error: configsError } = useConfigs();
  const nsConfig = configs?.find((c) => c.namespace === ns);

  const { data: runsData, mutate: mutateRuns } = useFetch<PaginatedResponse<RunRow>>(`/api/runs?ns=${ns}&per_page=100`);
  const { data: status } = useStatus();

  useGlobalEvents((event) => {
    if (event.namespace === ns) mutateRuns();
  });

  useKeyboard([
    {
      key: "f",
      description: "Filter pipelines",
      handler: () => filterRef.current?.focus(),
    },
  ]);

  useEffect(() => {
    if (nsConfig) document.title = `${nsConfig.display_name} — Trigger`;
    return () => {
      document.title = "Trigger";
    };
  }, [nsConfig]);

  const latestRuns = useMemo(() => {
    const map = new Map<string, RunRow>();
    for (const run of runsData?.data ?? []) {
      if (!map.has(run.pipeline_id)) map.set(run.pipeline_id, run);
    }
    return map;
  }, [runsData]);

  // Active runs per pipeline from WebSocket status
  const activeByPipeline = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of status?.pipelines ?? []) {
      if (p.namespace === ns) map.set(p.pipelineId, p.runIds.length);
    }
    return map;
  }, [status, ns]);

  const allPipelines = nsConfig?.pipelines ?? [];
  const filtered = filter
    ? allPipelines.filter((p) => p.name.toLowerCase().includes(filter.toLowerCase()) || p.id.toLowerCase().includes(filter.toLowerCase()))
    : allPipelines;

  let error = "";
  if (configsError) error = "Failed to load configs";
  else if (configs && !nsConfig) error = "Namespace not found";

  if (error) {
    return (
      <Layout>
        <ErrorMessage>{error}</ErrorMessage>
      </Layout>
    );
  }

  if (!nsConfig) {
    return (
      <Layout>
        <NamespaceSkeleton />
      </Layout>
    );
  }

  return (
    <Layout sidebar={<NamespaceNav current={ns} />} breadcrumbs={[{ label: nsConfig.display_name }]}>
      <div>
        {allPipelines.length === 0 ? (
          <EmptyState icon={<GitBranch size={48} />} title="No pipelines" description="This namespace has no pipelines configured." />
        ) : (
          <>
            <div className="flex items-center justify-between mb-2">
              <SectionHeader>
                Pipelines
                <span className="ml-1.5 text-neutral-600 normal-case tracking-normal">
                  {filter ? `${filtered.length} of ${allPipelines.length}` : allPipelines.length}
                </span>
              </SectionHeader>
            </div>
            <div className="relative mb-3">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none" />
              <input
                ref={filterRef}
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter pipelines…"
                className="w-full bg-white/[0.04] border border-white/[0.06] rounded-lg pl-8 pr-3 py-1.5 text-sm text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:border-white/[0.12] transition-colors"
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setFilter("");
                    filterRef.current?.blur();
                  }
                }}
              />
              {!filter && (
                <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-neutral-600 bg-white/[0.06] border border-white/[0.08] px-1.5 py-0.5 rounded font-mono">
                  F
                </kbd>
              )}
            </div>
            {filtered.length === 0 ? (
              <div className="text-sm text-neutral-500 text-center py-8">No pipelines match "{filter}"</div>
            ) : (
              <div className="bg-neutral-900/50 border border-white/[0.06] rounded-lg overflow-hidden">
                <div className="flex items-center gap-3 px-3 py-1.5 text-left text-neutral-500 text-xs font-medium border-b border-white/[0.04]">
                  <span className="flex-1 min-w-0">Pipeline</span>
                  <span className="shrink-0 w-[68px]">Status</span>
                  <span className="shrink-0 w-16">Last Run</span>
                  <span className="shrink-0 w-12">Duration</span>
                </div>
                <FocusList items={filtered} onSelect={(p) => navigate(`/${ns}/${p.id}`)} className="divide-y divide-white/[0.04]">
                  {(p, focused) => (
                    <PipelineRow
                      key={p.id}
                      ns={ns}
                      pipeline={p}
                      focused={focused}
                      lastRun={latestRuns.get(p.id)}
                      activeRuns={activeByPipeline.get(p.id) ?? 0}
                    />
                  )}
                </FocusList>
              </div>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}
