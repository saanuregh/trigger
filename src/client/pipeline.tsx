import { Clock, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { PaginatedResponse, PipelineDefSummary, RunRow, StepRow } from "../types.ts";
import { EmptyState } from "./components/EmptyState.tsx";
import { ErrorMessage } from "./components/ErrorMessage.tsx";
import { Layout } from "./components/Layout.tsx";
import { Pagination } from "./components/Pagination.tsx";
import { ParamForm, type ParamFormHandle } from "./components/ParamForm.tsx";
import { PipelineSidebar } from "./components/PipelineSidebar.tsx";
import { SectionHeader } from "./components/SectionHeader.tsx";
import { PipelineSkeleton } from "./components/Skeleton.tsx";
import { StatusDot } from "./components/StatusBadge.tsx";
import { useToast } from "./components/Toast.tsx";
import { useFetch, useNsDisplayName } from "./hooks.tsx";
import { FocusList, focusRingClass, useKeyboard } from "./keyboard.tsx";
import { Link, navigate, useRoute } from "./router.tsx";
import { describeCron, formatDuration, timeAgo, useLiveDuration } from "./utils.ts";
import { useGlobalEvents, useStatus } from "./ws.tsx";

const PER_PAGE = 20;

const STATUS_FILTERS = ["all", "running", "success", "failed", "cancelled"] as const;

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

function RunListItem({ ns, pipelineId, run, focused }: { ns: string; pipelineId: string; run: RunRow; focused: boolean }) {
  return (
    <Link
      to={`/${ns}/${pipelineId}/runs/${run.id}`}
      className={`flex items-center gap-3 px-3 py-1.5 hover:bg-white/[0.06] transition-colors no-underline ${focusRingClass(focused)}`}
    >
      <span className="flex-1 min-w-0 flex items-center gap-1.5">
        <span className="font-mono text-xs truncate">
          <span className="text-neutral-300">{run.id.slice(0, 8)}</span>
          <span className="text-neutral-600">{run.id.slice(8)}</span>
        </span>
        {run.dry_run === 1 && <span className="text-[10px] text-purple-400 font-medium shrink-0">DRY</span>}
      </span>
      <span className="shrink-0 w-[68px] flex items-center">
        <StatusDot status={run.status} />
      </span>
      <span className="text-neutral-500 text-xs shrink-0 w-16" title={run.started_at}>
        {timeAgo(run.started_at)}
      </span>
      <span className="text-neutral-500 font-mono text-xs shrink-0 w-12">
        <RunDuration run={run} />
      </span>
      <span
        className={`text-xs truncate shrink-0 w-14 text-right ${run.triggered_by === "scheduler" ? "text-amber-400/60" : "text-neutral-600"}`}
      >
        {run.triggered_by || "-"}
      </span>
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
  const formRef = useRef<ParamFormHandle>(null);

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

  const hasParams = (pipeline?.params ?? []).length > 0;

  useKeyboard([
    { key: "Enter", meta: true, description: "Run pipeline", handler: () => formRef.current?.triggerRun() },
    { key: "Enter", meta: true, shift: true, description: "Dry run", handler: () => formRef.current?.triggerDryRun() },
    { key: "f", description: "Focus params", handler: () => formRef.current?.focus(), when: hasParams },
    { key: "1", description: "Filter: All", handler: () => setStatusFilter("all") },
    { key: "2", description: "Filter: Running", handler: () => setStatusFilter("running") },
    { key: "3", description: "Filter: Success", handler: () => setStatusFilter("success") },
    { key: "4", description: "Filter: Failed", handler: () => setStatusFilter("failed") },
    { key: "5", description: "Filter: Cancelled", handler: () => setStatusFilter("cancelled") },
  ]);

  const handleRunStarted = (runId: string) => {
    toast(`[${nsDisplayName}] Pipeline run started`, "success");
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
            <SectionHeader>
              Run Pipeline
              {hasParams && <kbd className="ml-2 text-[10px] text-neutral-600 font-normal bg-white/[0.04] px-1.5 py-0.5 rounded">f</kbd>}
            </SectionHeader>
            <div className="flex items-center gap-3">
              {pipeline.schedule && (
                <span className="flex items-center gap-1 text-xs text-neutral-400">
                  <Clock size={12} className="text-neutral-500" />
                  {typeof pipeline.schedule === "string"
                    ? describeCron(pipeline.schedule)
                    : pipeline.schedule.map((s) => describeCron(s.cron)).join(", ")}
                </span>
              )}
              <span className="text-xs font-mono text-neutral-500">
                {activeRunIds.length}/{pipeline.concurrency} slots
              </span>
            </div>
          </div>
          <div className="bg-neutral-900/50 border border-white/[0.06] rounded-lg p-3">
            {pipeline.description && <p className="text-sm text-neutral-400 mb-2">{pipeline.description}</p>}
            <ParamForm
              ref={formRef}
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
        {!runsData ? null : runs.length === 0 && statusFilter === "all" ? (
          <EmptyState icon={<Clock size={48} />} title="No runs yet" description="Run this pipeline to see execution history." />
        ) : (
          <div>
            <div className="flex items-center justify-between mb-2">
              <SectionHeader>Recent Runs</SectionHeader>
              <div className="flex items-center gap-1">
                {STATUS_FILTERS.map((s, i) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStatusFilter(s)}
                    className={`text-xs px-2 py-0.5 rounded-full transition-colors ${
                      statusFilter === s ? "bg-white/[0.1] text-white" : "text-neutral-500 hover:text-neutral-300 hover:bg-white/[0.04]"
                    }`}
                  >
                    {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
                    <kbd className="ml-1 text-[10px] opacity-40">{i + 1}</kbd>
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

            {runs.length === 0 ? (
              <div className="text-center text-neutral-500 text-sm py-8">No {statusFilter} runs</div>
            ) : (
              <>
                <div className="bg-neutral-900/50 border border-white/[0.06] rounded-lg overflow-hidden">
                  <div className="flex items-center gap-3 px-3 py-1.5 text-left text-neutral-500 text-xs font-medium border-b border-white/[0.04]">
                    <span className="flex-1 min-w-0">Run</span>
                    <span className="shrink-0 w-[68px]">Status</span>
                    <span className="shrink-0 w-16">Started</span>
                    <span className="shrink-0 w-12">Duration</span>
                    <span className="shrink-0 w-14 text-right">By</span>
                  </div>
                  <FocusList
                    items={runs}
                    onSelect={(run) => navigate(`/${ns}/${pipelineId}/runs/${run.id}`)}
                    className="divide-y divide-white/[0.04]"
                  >
                    {(run, focused) => <RunListItem key={run.id} ns={ns} pipelineId={pipelineId} run={run} focused={focused} />}
                  </FocusList>
                </div>

                <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
              </>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
