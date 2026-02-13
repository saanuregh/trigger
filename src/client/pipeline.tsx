import { Clock } from "lucide-react";
import { useEffect, useState } from "react";
import useSWR from "swr";
import type { PaginatedResponse, PipelineDefSummary, RunRow } from "../types.ts";
import { EmptyState } from "./components/EmptyState.tsx";
import { Layout } from "./components/Layout.tsx";
import { Pagination } from "./components/Pagination.tsx";
import { ParamForm } from "./components/ParamForm.tsx";
import { PipelineSidebar } from "./components/PipelineSidebar.tsx";
import { PipelineSkeleton } from "./components/Skeleton.tsx";
import { StatusBadge } from "./components/StatusBadge.tsx";
import { useToast } from "./components/Toast.tsx";
import { Link, navigate, useRoute } from "./router.tsx";
import { useNsDisplayName } from "./swr.tsx";
import { formatDuration, formatTime } from "./utils.ts";

const PER_PAGE = 20;

function runDuration(run: RunRow): string {
  if (run.finished_at) return formatDuration(run.started_at, run.finished_at);
  if (run.status === "running") return "...";
  return "-";
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

  return (
    <Layout breadcrumbs={[{ label: nsDisplayName, href: `/${ns}` }, { label: pipeline.name }]} sidebar={sidebar}>
      <div>
        <div className="mb-6 pb-6 border-b border-gray-800">
          <h1 className="text-lg font-semibold mb-1">{pipeline.name}</h1>
          {pipeline.description && <p className="text-sm text-gray-400 mb-3">{pipeline.description}</p>}
          <ParamForm pipeline={pipeline} ns={ns} onRunStarted={handleRunStarted} />
        </div>

        {!runsData ? null : runs.length === 0 ? (
          <EmptyState icon={<Clock size={36} />} title="No runs yet" description="Run this pipeline to see execution history." />
        ) : (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-800">
                  <th className="pb-2 font-medium">Run</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 font-medium">Started</th>
                  <th className="pb-2 font-medium">
                    <span className="inline-flex items-center gap-1">
                      <Clock size={12} />
                      Duration
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id} className="border-b border-gray-800/50 hover:bg-gray-900/50 transition-colors">
                    <td className="py-2.5">
                      <Link
                        to={`/${ns}/${pipelineId}/runs/${run.id}`}
                        className="text-blue-400 hover:text-blue-300 no-underline font-mono text-xs"
                      >
                        {run.id.slice(0, 8)}
                      </Link>
                      {run.dry_run === 1 && (
                        <span className="ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-purple-900/60 text-purple-300">
                          DRY
                        </span>
                      )}
                    </td>
                    <td className="py-2.5">
                      <StatusBadge status={run.status} />
                    </td>
                    <td className="py-2.5 text-gray-400">
                      <span title={run.started_at}>{formatTime(run.started_at)}</span>
                    </td>
                    <td className="py-2.5 text-gray-400 font-mono text-xs">{runDuration(run)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
          </>
        )}
      </div>
    </Layout>
  );
}
