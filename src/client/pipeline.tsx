import { Clock, Loader2, Play } from "lucide-react";
import { useEffect, useState } from "react";
import useSWR from "swr";
import type { PaginatedResponse, PipelineDefSummary, RunRow } from "../types.ts";
import { EmptyState } from "./components/EmptyState.tsx";
import { Layout } from "./components/Layout.tsx";
import { Pagination } from "./components/Pagination.tsx";
import { ParamForm } from "./components/ParamForm.tsx";
import { PipelineSidebar } from "./components/PipelineSidebar.tsx";
import { PipelineSkeleton } from "./components/Skeleton.tsx";
import { StatusDot } from "./components/StatusBadge.tsx";
import { useToast } from "./components/Toast.tsx";
import { Link, navigate, useRoute } from "./router.tsx";
import { useNsDisplayName } from "./swr.tsx";
import { formatDuration, timeAgo, useLiveDuration } from "./utils.ts";

const PER_PAGE = 20;

function RunDuration({ run }: { run: RunRow }) {
  const live = useLiveDuration(run.started_at, run.status === "running");
  if (run.finished_at) return <>{formatDuration(run.started_at, run.finished_at)}</>;
  if (run.status === "running") return <span className="text-white">{live || "..."}</span>;
  return <>-</>;
}

export function PipelinePage() {
  const { ns, pipelineId } = useRoute().params as { ns: string; pipelineId: string };

  const nsDisplayName = useNsDisplayName(ns);
  const [page, setPage] = useState(1);
  const { toast } = useToast();

  const { data: pipeline, error } = useSWR<PipelineDefSummary>(`/api/pipelines/${ns}/${pipelineId}`);
  const { data: runsData } = useSWR<PaginatedResponse<RunRow>>(
    `/api/runs?ns=${ns}&pipeline_id=${pipelineId}&page=${page}&per_page=${PER_PAGE}`,
    { refreshInterval: 5000 },
  );

  const runs = runsData?.data ?? [];
  const totalPages = Math.ceil((runsData?.total ?? 0) / PER_PAGE);

  useEffect(() => {
    if (pipeline) document.title = `${pipeline.name} — Trigger`;
    return () => {
      document.title = "Trigger";
    };
  }, [pipeline]);

  const handleRunStarted = (runId: string) => {
    toast("Pipeline run started", "success");
    navigate(`/${ns}/${pipelineId}/runs/${runId}`);
  };

  const sidebar = <PipelineSidebar ns={ns} pipelineId={pipelineId} active="runs" />;

  if (error && !pipeline) {
    return (
      <Layout breadcrumbs={[{ label: nsDisplayName, href: `/${ns}` }, { label: pipelineId }]} sidebar={sidebar}>
        <div className="text-red-400">{error.message}</div>
      </Layout>
    );
  }

  if (!pipeline) {
    return (
      <Layout breadcrumbs={[{ label: nsDisplayName, href: `/${ns}` }, { label: pipelineId }]} sidebar={sidebar}>
        <PipelineSkeleton />
      </Layout>
    );
  }

  const activeRun = runs.find((r) => r.status === "running");

  // Read rerun param from URL for pre-filling
  const rerunId = new URLSearchParams(window.location.search).get("rerun");

  return (
    <Layout breadcrumbs={[{ label: nsDisplayName, href: `/${ns}` }, { label: pipeline.name }]} sidebar={sidebar}>
      <div className="space-y-8">
        {/* Trigger section */}
        <div className="bg-neutral-900 border border-neutral-700/50 rounded-xl overflow-hidden card-surface">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-neutral-800 bg-neutral-800/30">
            <Play size={14} className="text-neutral-400" />
            <h2 className="text-sm font-medium text-neutral-200">Run Pipeline</h2>
          </div>
          <div className="p-4">
            {pipeline.description && <p className="text-sm text-neutral-400 mb-3">{pipeline.description}</p>}
            <ParamForm pipeline={pipeline} ns={ns} onRunStarted={handleRunStarted} rerunId={rerunId} />
          </div>
        </div>

        {/* Runs section */}
        {!runsData ? null : runs.length === 0 ? (
          <EmptyState icon={<Clock size={48} />} title="No runs yet" description="Run this pipeline to see execution history." />
        ) : (
          <div>
            <h2 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider border-l-2 border-neutral-500 pl-2 mb-4">
              Recent Runs
            </h2>

            {activeRun && (
              <Link
                to={`/${ns}/${pipelineId}/runs/${activeRun.id}`}
                className="flex items-center gap-2.5 bg-neutral-800/40 border border-neutral-700/30 rounded-xl px-4 py-3 mb-4 no-underline hover:bg-neutral-800/60 transition-colors"
              >
                <Loader2 size={14} className="text-white animate-spin" />
                <span className="text-sm text-neutral-300">Pipeline is running</span>
                <span className="ml-auto text-xs font-mono text-neutral-300 bg-neutral-800 px-2 py-0.5 rounded">
                  {activeRun.id.slice(0, 8)}
                </span>
              </Link>
            )}

            <div className="bg-neutral-900 border border-neutral-700/50 rounded-xl overflow-hidden card-surface">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-neutral-500 bg-neutral-800/50 text-xs uppercase tracking-wider">
                    <th className="px-4 py-2.5 font-medium">Run</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5 font-medium">Started</th>
                    <th className="px-4 py-2.5 font-medium">Duration</th>
                    <th className="px-4 py-2.5 font-medium">By</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr key={run.id} className="border-b border-neutral-800/50 last:border-b-0 hover:bg-neutral-800/40 transition-colors">
                      <td className="px-4 py-2.5">
                        <Link
                          to={`/${ns}/${pipelineId}/runs/${run.id}`}
                          className="inline-flex items-center bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white no-underline font-mono text-xs px-2 py-0.5 rounded transition-colors"
                        >
                          {run.id.slice(0, 8)}
                        </Link>
                        {run.dry_run === 1 && (
                          <span className="ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-purple-900/60 text-purple-300">
                            DRY
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <StatusDot status={run.status} />
                      </td>
                      <td className="px-4 py-2.5 text-neutral-400 text-xs">
                        <span title={run.started_at}>{timeAgo(run.started_at)}</span>
                      </td>
                      <td className="px-4 py-2.5 text-neutral-400 font-mono text-xs">
                        <RunDuration run={run} />
                      </td>
                      <td className="px-4 py-2.5 text-neutral-500 text-xs truncate max-w-24">{run.triggered_by || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
          </div>
        )}
      </div>
    </Layout>
  );
}
