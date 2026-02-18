import { GitBranch, Loader2 } from "lucide-react";
import type { PaginatedResponse, RunRow } from "../types.ts";
import { EmptyState } from "./components/EmptyState.tsx";
import { Layout } from "./components/Layout.tsx";
import { NamespaceSkeleton } from "./components/Skeleton.tsx";
import { StatusDot } from "./components/StatusBadge.tsx";
import { useConfigs, useFetch } from "./hooks.tsx";
import { Link, navigate, useRoute } from "./router.tsx";
import { formatDuration, timeAgo } from "./utils.ts";
import { useGlobalEvents } from "./ws.tsx";

export function NamespacePage() {
  const { ns } = useRoute().params as { ns: string };

  const { data: configs, error: configsError } = useConfigs();
  const nsConfig = configs?.find((c) => c.namespace === ns);

  const { data: runsData, mutate: mutateRuns } = useFetch<PaginatedResponse<RunRow>>(`/api/runs?ns=${ns}&per_page=100`);
  const { data: runningData, mutate: mutateRunning } = useFetch<PaginatedResponse<RunRow>>(`/api/runs?ns=${ns}&status=running&per_page=50`);

  useGlobalEvents((event) => {
    if (event.namespace === ns) {
      mutateRuns();
      mutateRunning();
    }
  });

  const latestRuns = new Map<string, RunRow>();
  for (const run of runsData?.data ?? []) {
    if (!latestRuns.has(run.pipeline_id)) latestRuns.set(run.pipeline_id, run);
  }

  const runningByPipeline = new Map<string, RunRow[]>();
  for (const run of runningData?.data ?? []) {
    const arr = runningByPipeline.get(run.pipeline_id) ?? [];
    arr.push(run);
    runningByPipeline.set(run.pipeline_id, arr);
  }

  let error = "";
  if (configsError) error = "Failed to load configs";
  else if (configs && !nsConfig) error = "Namespace not found";

  if (error) {
    return (
      <Layout breadcrumbs={[{ label: ns }]}>
        <div className="text-red-400">{error}</div>
      </Layout>
    );
  }

  if (!nsConfig) {
    return (
      <Layout breadcrumbs={[{ label: ns }]}>
        <NamespaceSkeleton />
      </Layout>
    );
  }

  const sidebar =
    runningByPipeline.size > 0 ? (
      <div>
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-neutral-500 uppercase tracking-wider mb-2">
          <Loader2 size={12} className="animate-spin text-neutral-400" />
          Running
        </div>
        {[...runningByPipeline.entries()].map(([pipelineId, runs]) => (
          <Link
            key={pipelineId}
            to={`/${ns}/${pipelineId}`}
            className="flex items-center gap-2 px-2 py-1.5 text-sm text-neutral-300 hover:text-white hover:bg-white/[0.04] rounded-lg no-underline transition-colors"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse shrink-0" />
            {runs[0]!.pipeline_name}
            {runs.length > 1 && <span className="text-[10px] text-neutral-500 font-mono">{runs.length}</span>}
          </Link>
        ))}
      </div>
    ) : undefined;

  return (
    <Layout breadcrumbs={[{ label: nsConfig.display_name }]} sidebar={sidebar}>
      <div>
        <h1 className="text-xl font-semibold tracking-tight mb-5">{nsConfig.display_name}</h1>
        {nsConfig.pipelines.length === 0 ? (
          <EmptyState icon={<GitBranch size={48} />} title="No pipelines" description="This namespace has no pipelines configured." />
        ) : (
          <div className="bg-neutral-900/50 border border-white/[0.06] rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-neutral-500 text-[11px] font-medium">
                  <th className="px-4 py-2.5">Pipeline</th>
                  <th className="px-4 py-2.5 w-16">Steps</th>
                  <th className="px-4 py-2.5 w-24">Concurrency</th>
                  <th className="px-4 py-2.5">Last Run</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5 w-20">Duration</th>
                </tr>
              </thead>
              <tbody>
                {nsConfig.pipelines.map((p) => {
                  const lastRun = latestRuns.get(p.id);
                  return (
                    <tr
                      key={p.id}
                      className="border-t border-white/[0.04] hover:bg-white/[0.03] transition-colors cursor-pointer"
                      onClick={() => navigate(`/${ns}/${p.id}`)}
                    >
                      <td className="px-4 py-2.5">
                        <Link to={`/${ns}/${p.id}`} className="text-neutral-200 hover:text-white no-underline font-medium">
                          {p.name}
                        </Link>
                        {p.description && <div className="text-xs text-neutral-500 mt-0.5">{p.description}</div>}
                      </td>
                      <td className="px-4 py-2.5 text-neutral-500 text-xs font-mono">{p.steps.length}</td>
                      <td className="px-4 py-2.5 text-xs font-mono">
                        {(() => {
                          const running = runningByPipeline.get(p.id)?.length ?? 0;
                          return running > 0 ? (
                            <span className="text-white">
                              {running}/{p.concurrency}
                            </span>
                          ) : (
                            <span className="text-neutral-500">{p.concurrency}</span>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-2.5 text-neutral-500 text-xs">
                        {lastRun ? (
                          <span title={lastRun.started_at}>{timeAgo(lastRun.started_at)}</span>
                        ) : (
                          <span className="text-neutral-600">-</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        {lastRun ? <StatusDot status={lastRun.status} /> : <span className="text-xs text-neutral-600">-</span>}
                      </td>
                      <td className="px-4 py-2.5 text-neutral-500 text-xs font-mono">
                        {lastRun?.finished_at ? formatDuration(lastRun.started_at, lastRun.finished_at) : lastRun ? "..." : "-"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Layout>
  );
}
