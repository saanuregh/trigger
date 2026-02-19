import { Clock, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { PaginatedResponse, PipelineDefSummary, RunRow, StepRow } from "../types.ts";
import { EmptyState } from "./components/EmptyState.tsx";
import { ErrorMessage } from "./components/ErrorMessage.tsx";
import { Layout } from "./components/Layout.tsx";
import { Pagination } from "./components/Pagination.tsx";
import { ParamForm } from "./components/ParamForm.tsx";
import { PipelineSidebar } from "./components/PipelineSidebar.tsx";
import { SectionHeader } from "./components/SectionHeader.tsx";
import { PipelineSkeleton } from "./components/Skeleton.tsx";
import { StatusDot } from "./components/StatusBadge.tsx";
import { useToast } from "./components/Toast.tsx";
import { useFetch, useNsDisplayName } from "./hooks.tsx";
import { Link, navigate, useRoute } from "./router.tsx";
import { formatDuration, timeAgo, useLiveDuration } from "./utils.ts";
import { useGlobalEvents, useStatus } from "./ws.tsx";

const PER_PAGE = 20;

function RunDuration({ run }: { run: RunRow }) {
  const live = useLiveDuration(run.started_at, run.status === "running");
  if (run.finished_at) return <>{formatDuration(run.started_at, run.finished_at)}</>;
  if (run.status === "running") return <span className="text-white">{live || "..."}</span>;
  return <>-</>;
}

function ActiveRunBanner({ ns, pipelineId, runId }: { ns: string; pipelineId: string; runId: string }) {
  const { data } = useFetch<{ run: RunRow; steps: StepRow[] }>(`/api/runs/${runId}`);
  const steps = data?.steps ?? [];
  const runningStep = steps.find((s) => s.status === "running");

  return (
    <Link
      to={`/${ns}/${pipelineId}/runs/${runId}`}
      className="flex items-center gap-2 bg-white/[0.03] border border-white/[0.06] rounded-lg px-3 py-2 no-underline hover:bg-white/[0.05] transition-colors"
    >
      <Loader2 size={14} className="text-white animate-spin shrink-0" />
      <span className="text-sm text-neutral-300 flex-1 min-w-0 truncate">
        {runningStep ? (
          <>
            Step {steps.indexOf(runningStep) + 1}/{steps.length}
            <span className="text-neutral-500"> — {runningStep.step_name}</span>
          </>
        ) : (
          "Pipeline is running"
        )}
      </span>
      <span className="text-xs font-mono text-neutral-300 bg-white/[0.04] px-2 py-0.5 rounded-lg shrink-0">{runId.slice(0, 8)}</span>
    </Link>
  );
}

export function PipelinePage() {
  const { ns, pipelineId } = useRoute().params as { ns: string; pipelineId: string };

  const route = useRoute();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("all");
  const { toast } = useToast();
  const { data: status } = useStatus();
  const nsDisplayName = useNsDisplayName(ns);

  const { data: pipeline, error } = useFetch<PipelineDefSummary>(`/api/pipelines/${ns}/${pipelineId}`);
  const statusParam = statusFilter !== "all" ? `&status=${statusFilter}` : "";
  const { data: runsData, mutate: mutateRuns } = useFetch<PaginatedResponse<RunRow>>(
    `/api/runs?ns=${ns}&pipeline_id=${pipelineId}&page=${page}&per_page=${PER_PAGE}${statusParam}`,
  );

  useGlobalEvents((event) => {
    if (event.namespace === ns && event.pipelineId === pipelineId) mutateRuns();
  });

  const runs = runsData?.data ?? [];
  const totalPages = Math.ceil((runsData?.total ?? 0) / PER_PAGE);

  // Reset to page 1 when filter changes
  useEffect(() => setPage(1), [statusFilter]);

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
      <Layout sidebar={sidebar}>
        <ErrorMessage>{error.message}</ErrorMessage>
      </Layout>
    );
  }

  if (!pipeline) {
    return (
      <Layout sidebar={sidebar}>
        <PipelineSkeleton />
      </Layout>
    );
  }

  // Active runs from real-time WebSocket status (not stale paginated data)
  const activeRunIds = status?.pipelines.find((p) => p.namespace === ns && p.pipelineId === pipelineId)?.runIds ?? [];

  const rerunId = new URLSearchParams(route.search).get("rerun");

  return (
    <Layout sidebar={sidebar} breadcrumbs={[{ label: nsDisplayName, to: `/${ns}` }, { label: pipeline.name }]}>
      <div className="space-y-5">
        {/* Trigger section */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <SectionHeader>Run Pipeline</SectionHeader>
            <span className="text-xs font-mono text-neutral-500">
              {activeRunIds.length}/{pipeline.concurrency} slots
            </span>
          </div>
          <div className="bg-neutral-900/50 border border-white/[0.06] rounded-lg p-3">
            {pipeline.description && <p className="text-sm text-neutral-400 mb-2">{pipeline.description}</p>}
            <ParamForm
              pipeline={pipeline}
              ns={ns}
              onRunStarted={handleRunStarted}
              rerunId={rerunId}
              activeRunCount={activeRunIds.length}
              atGlobalLimit={status ? status.activeRuns >= status.maxConcurrentRuns : false}
            />
          </div>
        </div>

        {/* Runs section */}
        {!runsData ? null : runs.length === 0 ? (
          <EmptyState icon={<Clock size={48} />} title="No runs yet" description="Run this pipeline to see execution history." />
        ) : (
          <div>
            <div className="flex items-center justify-between mb-2">
              <SectionHeader>Recent Runs</SectionHeader>
              <div className="flex items-center gap-1">
                {["all", "running", "success", "failed", "cancelled"].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStatusFilter(s)}
                    className={`text-xs px-2 py-0.5 rounded-full transition-colors ${
                      statusFilter === s ? "bg-white/[0.1] text-white" : "text-neutral-500 hover:text-neutral-300 hover:bg-white/[0.04]"
                    }`}
                  >
                    {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {activeRunIds.length > 0 && (
              <div className="space-y-1.5 mb-3">
                {activeRunIds.map((runId) => (
                  <ActiveRunBanner key={runId} ns={ns} pipelineId={pipelineId} runId={runId} />
                ))}
              </div>
            )}

            <div className="bg-neutral-900/50 border border-white/[0.06] rounded-lg overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-neutral-500 text-xs font-medium">
                    <th className="px-3 py-1.5">Run</th>
                    <th className="px-3 py-1.5">Status</th>
                    <th className="px-3 py-1.5">Started</th>
                    <th className="px-3 py-1.5">Duration</th>
                    <th className="px-3 py-1.5">By</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr key={run.id} className="border-t border-white/[0.04] hover:bg-white/[0.04] transition-colors">
                      <td className="px-3 py-1.5">
                        <Link
                          to={`/${ns}/${pipelineId}/runs/${run.id}`}
                          className="inline-flex items-center bg-white/[0.06] hover:bg-white/[0.1] text-neutral-300 hover:text-white no-underline font-mono text-xs px-2 py-0.5 rounded-lg transition-colors"
                        >
                          {run.id.slice(0, 8)}
                        </Link>
                        {run.dry_run === 1 && (
                          <span className="ml-2 text-[11px] font-semibold px-1.5 py-0.5 rounded-full bg-purple-500/15 text-purple-300 border border-purple-500/15">
                            DRY
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-1.5">
                        <StatusDot status={run.status} />
                      </td>
                      <td className="px-3 py-1.5 text-neutral-400 text-xs">
                        <span title={run.started_at}>{timeAgo(run.started_at)}</span>
                      </td>
                      <td className="px-3 py-1.5 text-neutral-400 font-mono text-xs">
                        <RunDuration run={run} />
                      </td>
                      <td className="px-3 py-1.5 text-neutral-500 text-xs truncate max-w-24">{run.triggered_by || "-"}</td>
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
