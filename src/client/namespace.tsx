import { GitBranch, Loader2 } from "lucide-react";
import useSWR from "swr";
import type { PaginatedResponse, RunRow } from "../types.ts";
import { CardLink } from "./components/Card.tsx";
import { EmptyState } from "./components/EmptyState.tsx";
import { Layout } from "./components/Layout.tsx";
import { NamespaceSkeleton } from "./components/Skeleton.tsx";
import { StatusBadge } from "./components/StatusBadge.tsx";
import { renderPage, useConfigs } from "./swr.tsx";
import { formatTime } from "./utils.ts";

function NamespacePage() {
  const ns = location.pathname.split("/")[1]!;

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
        <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
          <Loader2 size={12} className="animate-spin text-blue-400" />
          Running
        </div>
        {runningPipelines.map((run) => (
          <a
            key={run.pipeline_id}
            href={`/${ns}/${run.pipeline_id}`}
            className="flex items-center gap-2 px-2 py-1.5 text-sm text-blue-400 hover:text-blue-300 hover:bg-gray-800 rounded-md no-underline transition-colors"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse shrink-0" />
            {run.pipeline_name}
          </a>
        ))}
      </div>
    ) : undefined;

  return (
    <Layout breadcrumbs={[{ label: nsConfig.display_name }]} sidebar={sidebar}>
      <div>
        <h1 className="text-lg font-semibold mb-4">{nsConfig.display_name}</h1>
        {nsConfig.pipelines.length === 0 ? (
          <EmptyState icon={<GitBranch size={40} />} title="No pipelines" description="This namespace has no pipelines configured." />
        ) : (
          <div className="space-y-2">
            {nsConfig.pipelines.map((p) => {
              const lastRun = latestRuns.get(p.id);
              return (
                <CardLink key={p.id} href={`/${ns}/${p.id}`} className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-gray-800 flex items-center justify-center shrink-0">
                      <GitBranch size={16} className="text-gray-400" />
                    </div>
                    <div>
                      <div className="text-sm font-medium text-gray-200">{p.name}</div>
                      {p.description && <div className="text-xs text-gray-500 mt-0.5">{p.description}</div>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-xs text-gray-600">
                      {p.steps.length} step{p.steps.length !== 1 ? "s" : ""}
                    </span>
                    {lastRun ? (
                      <>
                        <span className="text-xs text-gray-500">{formatTime(lastRun.started_at)}</span>
                        <StatusBadge status={lastRun.status} />
                      </>
                    ) : (
                      <span className="text-xs text-gray-600">No runs</span>
                    )}
                  </div>
                </CardLink>
              );
            })}
          </div>
        )}
      </div>
    </Layout>
  );
}

renderPage(NamespacePage);
