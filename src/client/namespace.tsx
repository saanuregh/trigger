import { GitBranch, Loader2 } from "lucide-react";
import useSWR from "swr";
import type { PaginatedResponse, RunRow } from "../types.ts";
import { EmptyState } from "./components/EmptyState.tsx";
import { Layout } from "./components/Layout.tsx";
import { NamespaceSkeleton } from "./components/Skeleton.tsx";
import { StatusDot } from "./components/StatusBadge.tsx";
import { Link, navigate, useRoute } from "./router.tsx";
import { useConfigs } from "./swr.tsx";
import { formatDuration, timeAgo } from "./utils.ts";

export function NamespacePage() {
  const { ns } = useRoute().params as { ns: string };

  const { data: configs, error: configsError } = useConfigs();
  const nsConfig = configs?.find((c) => c.namespace === ns);

  const { data: runsData } = useSWR<PaginatedResponse<RunRow>>(`/api/runs?ns=${ns}&per_page=100`);
  const { data: runningData } = useSWR<PaginatedResponse<RunRow>>(`/api/runs?ns=${ns}&status=running&per_page=50`);

  const latestRuns = new Map<string, RunRow>();
  if (runsData) {
    for (const run of runsData.data) {
      if (!latestRuns.has(run.pipeline_id)) latestRuns.set(run.pipeline_id, run);
    }
  }

  const runningPipelines: RunRow[] = [];
  if (runningData) {
    const seen = new Set<string>();
    for (const run of runningData.data) {
      if (!seen.has(run.pipeline_id)) {
        seen.add(run.pipeline_id);
        runningPipelines.push(run);
      }
    }
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
    runningPipelines.length > 0 ? (
      <div>
        <div className="flex items-center gap-1.5 text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">
          <Loader2 size={12} className="animate-spin text-neutral-400" />
          Running
        </div>
        {runningPipelines.map((run) => (
          <Link
            key={run.pipeline_id}
            to={`/${ns}/${run.pipeline_id}`}
            className="flex items-center gap-2 px-2 py-1.5 text-sm text-neutral-300 hover:text-white hover:bg-neutral-800 rounded-md no-underline transition-colors"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse shrink-0" />
            {run.pipeline_name}
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
          <div className="bg-neutral-900 border border-neutral-700/50 rounded-xl overflow-hidden card-surface">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-neutral-500 bg-neutral-800/50 text-xs uppercase tracking-wider">
                  <th className="px-4 py-2.5 font-medium">Pipeline</th>
                  <th className="px-4 py-2.5 font-medium w-16">Steps</th>
                  <th className="px-4 py-2.5 font-medium">Last Run</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium w-20">Duration</th>
                </tr>
              </thead>
              <tbody>
                {nsConfig.pipelines.map((p) => {
                  const lastRun = latestRuns.get(p.id);
                  return (
                    <tr
                      key={p.id}
                      className="border-b border-neutral-800/50 last:border-b-0 hover:bg-neutral-800/40 transition-colors cursor-pointer"
                      onClick={() => navigate(`/${ns}/${p.id}`)}
                    >
                      <td className="px-4 py-2.5">
                        <Link to={`/${ns}/${p.id}`} className="text-neutral-200 hover:text-white no-underline font-medium">
                          {p.name}
                        </Link>
                        {p.description && <div className="text-xs text-neutral-500 mt-0.5">{p.description}</div>}
                      </td>
                      <td className="px-4 py-2.5 text-neutral-500 text-xs font-mono">{p.steps.length}</td>
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
