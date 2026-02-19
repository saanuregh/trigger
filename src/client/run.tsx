import { AlertCircle, Download, Play, RotateCcw, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { type LogLine, type RunRow, type StepRow, TERMINAL_STATUSES } from "../types.ts";
import { Button } from "./components/Button.tsx";
import { ConfirmDialog } from "./components/ConfirmDialog.tsx";
import { Layout } from "./components/Layout.tsx";
import { LogViewer } from "./components/LogViewer.tsx";
import { PipelineSidebar } from "./components/PipelineSidebar.tsx";
import { RunSkeleton } from "./components/Skeleton.tsx";
import { StatusBadge, StepIcon } from "./components/StatusBadge.tsx";
import { useToast } from "./components/Toast.tsx";
import { useConfigs, useFetch } from "./hooks.tsx";
import { navigate, useRoute } from "./router.tsx";
import {
  formatDuration,
  handleUnauthorized,
  requestNotificationPermission,
  setFaviconStatus,
  showRunNotification,
  timeAgo,
  useLiveDuration,
} from "./utils.ts";
import { useSubscription } from "./ws.tsx";

function StepProgress({ steps }: { steps: StepRow[] }) {
  const runningIdx = steps.findIndex((s) => s.status === "running");
  if (runningIdx >= 0) {
    return (
      <span className="text-xs text-neutral-400 font-mono">
        {runningIdx + 1}/{steps.length}
      </span>
    );
  }
  const done = steps.filter((s) => s.status === "success" || s.status === "failed" || s.status === "skipped").length;
  return (
    <span className="text-xs text-neutral-500 font-mono">
      {done}/{steps.length}
    </span>
  );
}

function StepProgressBar({ steps }: { steps: StepRow[] }) {
  if (steps.length === 0) return null;

  return (
    <div className="flex gap-0.5 mb-2">
      {steps.map((step) => (
        <div
          key={step.step_id}
          className={`h-1 flex-1 rounded-full transition-colors duration-500 ${
            step.status === "success"
              ? "bg-green-400"
              : step.status === "failed"
                ? "bg-red-400"
                : step.status === "running"
                  ? "bg-white animate-pulse"
                  : step.status === "skipped"
                    ? "bg-neutral-700"
                    : "bg-neutral-800"
          }`}
        />
      ))}
    </div>
  );
}

export function RunPage() {
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [cancelling, setCancelling] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  const [showRetryConfirm, setShowRetryConfirm] = useState(false);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [autoFollow, setAutoFollow] = useState(true);
  const [pulsingSteps, setPulsingSteps] = useState<Set<string>>(new Set());
  const prevStepsRef = useRef<Map<string, string>>(new Map());
  const { toast } = useToast();

  const logBufferRef = useRef<LogLine[]>([]);
  const rafRef = useRef<number>(0);

  const flushLogs = useCallback(() => {
    rafRef.current = 0;
    const batch = logBufferRef.current;
    if (batch.length === 0) return;
    logBufferRef.current = [];
    setLogs((prev) => prev.concat(batch));
  }, []);

  const { ns, pipelineId, runId } = useRoute().params as { ns: string; pipelineId: string; runId: string };

  const { data, error, mutate } = useFetch<{ run: RunRow; steps: StepRow[] }>(`/api/runs/${runId}`);
  const run = data?.run ?? null;
  const steps = data?.steps ?? [];

  const { data: configs } = useConfigs();
  const nsDisplayName = configs?.find((c) => c.namespace === ns)?.display_name ?? ns;

  useEffect(() => {
    if (run) document.title = `Run #${runId.slice(0, 8)} — ${run.pipeline_name} — Trigger`;
    return () => {
      document.title = "Trigger";
    };
  }, [run, runId]);

  useEffect(() => {
    if (run) setFaviconStatus(run.status);
    return () => setFaviconStatus(null);
  }, [run?.status]);

  const isTerminal = run ? TERMINAL_STATUSES.has(run.status) : null;
  const liveDuration = useLiveDuration(run?.started_at ?? null, run?.status === "running");
  const pipelineNameRef = useRef(run?.pipeline_name ?? "");
  pipelineNameRef.current = run?.pipeline_name ?? "";

  useEffect(() => {
    if (!isTerminal) return;
    fetch(`/api/runs/${runId}/logs`)
      .then((r) => r.json())
      .then((data: { lines: LogLine[] }) => setLogs(data.lines))
      .catch(console.error);
  }, [isTerminal, runId]);

  useEffect(() => {
    if (isTerminal !== false) return;
    requestNotificationPermission();
  }, [isTerminal]);

  useSubscription(isTerminal === false ? `run:${runId}` : null, {
    onLog(entry) {
      logBufferRef.current.push(entry);
      if (!rafRef.current) {
        rafRef.current = requestAnimationFrame(flushLogs);
      }
    },
    onStep(stepData) {
      mutate(
        (prev) =>
          prev && {
            ...prev,
            steps: prev.steps.map((s) => (s.step_id === stepData.stepId ? { ...s, status: stepData.status as StepRow["status"] } : s)),
          },
      );
    },
    onRunStatus({ status }) {
      mutate((prev) => prev && { ...prev, run: { ...prev.run, status: status as RunRow["status"] } });
      if (TERMINAL_STATUSES.has(status)) {
        showRunNotification(pipelineNameRef.current, status);
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        flushLogs();
      }
    },
  });

  useEffect(() => {
    if (!autoFollow) return;
    const runningStep = steps.find((s) => s.status === "running");
    if (runningStep) setSelectedStepId(runningStep.step_id);
  }, [steps, autoFollow]);

  useEffect(() => {
    const newPulsing = new Set<string>();
    for (const step of steps) {
      const prev = prevStepsRef.current.get(step.step_id);
      if (step.status === "running" && prev && prev !== "running") {
        newPulsing.add(step.step_id);
      }
      prevStepsRef.current.set(step.step_id, step.status);
    }
    if (newPulsing.size > 0) {
      setPulsingSteps(newPulsing);
      const timer = setTimeout(() => setPulsingSteps(new Set()), 1000);
      return () => clearTimeout(timer);
    }
  }, [steps]);

  const selectStep = (stepId: string | null) => {
    setAutoFollow(false);
    setSelectedStepId(stepId);
  };

  const handleStop = useCallback(async () => {
    setCancelling(true);
    setShowStopConfirm(false);
    try {
      const res = await fetch(`/api/runs/${runId}/cancel`, { method: "POST" });
      handleUnauthorized(res);
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Stop failed" }));
        toast(data.error ?? "Stop failed", "error");
      } else {
        toast("Run cancelled", "info");
      }
    } catch (err) {
      console.error("Stop failed:", err);
      toast("Failed to stop run", "error");
    } finally {
      setCancelling(false);
    }
  }, [runId, toast]);

  const handleRetry = useCallback(async () => {
    setRetrying(true);
    setShowRetryConfirm(false);
    try {
      const res = await fetch(`/api/runs/${runId}/retry`, { method: "POST" });
      handleUnauthorized(res);
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Retry failed" }));
        if (res.status === 409) {
          toast("Pipeline at max concurrency — wait for a run to finish or cancel one first", "error");
        } else {
          toast(data.error ?? "Retry failed", "error");
        }
        return;
      }
      toast("Retrying from failed step", "success");
      setLogs([]);
      mutate(
        (prev) =>
          prev && {
            ...prev,
            run: { ...prev.run, status: "running" as RunRow["status"], error: null },
            steps: prev.steps.map((s) =>
              s.status === "failed" || s.status === "skipped" ? { ...s, status: "pending" as StepRow["status"], error: null } : s,
            ),
          },
      );
    } catch (err) {
      console.error("Retry failed:", err);
      toast("Failed to retry run", "error");
    } finally {
      setRetrying(false);
    }
  }, [runId, toast, mutate]);

  const handleDownloadLogs = useCallback(async () => {
    try {
      const res = await fetch(`/api/runs/${runId}/logs`);
      const data = (await res.json()) as { lines: LogLine[] };
      const ndjson = data.lines.map((l) => JSON.stringify(l)).join("\n");
      const blob = new Blob([ndjson], { type: "application/x-ndjson" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `run-${runId}.log`;
      a.click();
      URL.revokeObjectURL(url);
      toast("Logs downloaded", "success");
    } catch (err) {
      console.error("Download failed:", err);
      toast("Failed to download logs", "error");
    }
  }, [runId, toast]);

  const pipelineName = run?.pipeline_name ?? pipelineId;
  const sidebar = <PipelineSidebar ns={ns} pipelineId={pipelineId} active="runs" />;

  if (error) {
    return (
      <Layout sidebar={sidebar}>
        <div className="text-red-400">{error.message}</div>
      </Layout>
    );
  }

  if (!run) {
    return (
      <Layout sidebar={sidebar}>
        <RunSkeleton />
      </Layout>
    );
  }

  const isActive = run.status === "running" || run.status === "pending";

  return (
    <Layout
      sidebar={sidebar}
      breadcrumbs={[
        { label: nsDisplayName, to: `/${ns}` },
        { label: pipelineName, to: `/${ns}/${pipelineId}` },
        { label: `Run #${runId.slice(0, 8)}` },
      ]}
      actions={
        <div className="flex items-center gap-2">
          {steps.length > 0 && <StepProgress steps={steps} />}
          {isActive && (
            <Button variant="danger" onClick={() => setShowStopConfirm(true)} loading={cancelling} icon={<Square size={12} />}>
              Stop
            </Button>
          )}
          {run.status === "failed" && (
            <Button onClick={() => setShowRetryConfirm(true)} loading={retrying} icon={<Play size={14} />}>
              Retry
            </Button>
          )}
          {!isActive && (
            <Button onClick={() => navigate(`/${ns}/${pipelineId}?rerun=${runId}`)} icon={<RotateCcw size={14} />}>
              Re-run
            </Button>
          )}
          <Button onClick={handleDownloadLogs} icon={<Download size={14} />}>
            Logs
          </Button>
        </div>
      }
    >
      <div className="h-full flex flex-col">
        {/* Run info bar */}
        <div className="flex items-center gap-3 mb-4 shrink-0">
          <StatusBadge status={run.status} />
          <div className="text-xs text-neutral-500">
            <span className="font-mono" title={run.started_at}>
              {timeAgo(run.started_at)}
            </span>
            {run.triggered_by && <span className="ml-2">by {run.triggered_by}</span>}
            {liveDuration && <span className="ml-2 font-mono text-white">{liveDuration}</span>}
          </div>
          {run.dry_run === 1 && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-500/15 text-purple-300 border border-purple-500/15">
              DRY RUN
            </span>
          )}
        </div>

        {/* Error banner */}
        {run.error && (
          <div className="flex items-start gap-3 bg-red-500/[0.08] border border-red-500/15 rounded-lg p-3 mb-4 shrink-0">
            <AlertCircle size={16} className="text-red-400 shrink-0 mt-0.5" />
            <div className="text-sm text-red-300">{run.error}</div>
          </div>
        )}

        {/* Side-by-side: Steps + Logs */}
        <div className="flex gap-4 flex-1 min-h-0">
          {/* Steps panel */}
          <div className="w-60 shrink-0 overflow-y-auto pr-3 flex flex-col gap-0.5">
            <StepProgressBar steps={steps} />
            <button
              type="button"
              onClick={() => selectStep(null)}
              className={`w-full text-left text-xs px-2.5 py-2 rounded-lg transition-all duration-150 active:scale-[0.98] ${
                selectedStepId === null
                  ? "bg-white/[0.08] text-white font-medium"
                  : "text-neutral-400 hover:text-white hover:bg-white/[0.04]"
              }`}
            >
              All steps
            </button>

            {steps.map((step) => {
              const isSelected = selectedStepId === step.step_id;

              return (
                <button
                  key={step.step_id}
                  type="button"
                  onClick={() => selectStep(selectedStepId === step.step_id ? null : step.step_id)}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-colors text-left ${
                    isSelected ? "bg-white/[0.06]" : "hover:bg-white/[0.04]"
                  } ${pulsingSteps.has(step.step_id) ? "step-pulse" : ""}`}
                >
                  <StepIcon status={step.status} size={14} />
                  <div className="min-w-0 flex-1">
                    <div className={`text-xs font-medium truncate ${step.status === "skipped" ? "text-neutral-600" : "text-neutral-200"}`}>
                      {step.step_name}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[10px] text-neutral-600 font-mono">{step.action}</span>
                      {step.started_at && step.finished_at && (
                        <span className="text-[10px] text-neutral-600 font-mono">{formatDuration(step.started_at, step.finished_at)}</span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Log viewer */}
          <div className="flex-1 min-w-0 flex flex-col">
            <LogViewer lines={logs} stepFilter={selectedStepId} fullHeight />
          </div>
        </div>

        <ConfirmDialog
          open={showStopConfirm}
          onCancel={() => setShowStopConfirm(false)}
          onConfirm={handleStop}
          title="Stop this run?"
          description="The pipeline will be cancelled and any in-progress steps will be terminated."
          confirmLabel="Stop Run"
          variant="danger"
          loading={cancelling}
        />
        <ConfirmDialog
          open={showRetryConfirm}
          onCancel={() => setShowRetryConfirm(false)}
          onConfirm={handleRetry}
          title="Retry from failed step?"
          description={`This will re-run "${steps.find((s) => s.status === "failed")?.step_name ?? "the failed step"}" and all subsequent steps using the same parameters. Already succeeded steps will not be re-executed.`}
          confirmLabel="Retry"
          loading={retrying}
        />
      </div>
    </Layout>
  );
}
