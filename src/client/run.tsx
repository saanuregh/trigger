import { AlertCircle, Download, Play, RotateCcw, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import useSWR from "swr";
import type { LogLine, RunRow, StepRow } from "../types.ts";
import { TERMINAL_STATUSES } from "../types.ts";
import { Button } from "./components/Button.tsx";
import { ConfirmDialog } from "./components/ConfirmDialog.tsx";
import { Layout } from "./components/Layout.tsx";
import { LogViewer } from "./components/LogViewer.tsx";
import { RunSkeleton } from "./components/Skeleton.tsx";
import { StatusBadge, StepIcon } from "./components/StatusBadge.tsx";
import { useToast } from "./components/Toast.tsx";
import { navigate, useRoute } from "./router.tsx";
import { useNsDisplayName } from "./swr.tsx";
import {
  formatDuration,
  handleUnauthorized,
  requestNotificationPermission,
  setFaviconStatus,
  showRunNotification,
  timeAgo,
  useLiveDuration,
} from "./utils.ts";

const stepCircleStyles: Record<string, string> = {
  running: "border-neutral-400/50 bg-neutral-800/50 animate-pulse-ring",
  success: "border-green-800/50 bg-green-950/30 shadow-[0_0_10px_rgba(74,222,128,0.25)]",
  failed: "border-red-800/50 bg-red-950/30 shadow-[0_0_10px_rgba(248,113,113,0.25)]",
};

export function RunPage() {
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [cancelling, setCancelling] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  const [showRetryConfirm, setShowRetryConfirm] = useState(false);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [autoFollow, setAutoFollow] = useState(true);
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

  const nsDisplayName = useNsDisplayName(ns);

  const { data, error, mutate } = useSWR<{ run: RunRow; steps: StepRow[] }>(`/api/runs/${runId}`, { revalidateOnFocus: false });
  const run = data?.run ?? null;
  const steps = data?.steps ?? [];

  useEffect(() => {
    if (run) document.title = `Run #${runId.slice(0, 8)} — ${run.pipeline_name} — Trigger`;
    return () => {
      document.title = "Trigger";
    };
  }, [run, runId]);

  // Dynamic favicon based on run status
  useEffect(() => {
    if (run) setFaviconStatus(run.status);
    return () => setFaviconStatus(null);
  }, [run?.status]);

  const isTerminal = run ? TERMINAL_STATUSES.has(run.status) : null;
  const liveDuration = useLiveDuration(run?.started_at ?? null, run?.status === "running");
  const pipelineNameRef = useRef(run?.pipeline_name ?? "");
  pipelineNameRef.current = run?.pipeline_name ?? "";

  // Fetch logs via HTTP when run is already terminal (or becomes terminal via SWR revalidation)
  useEffect(() => {
    if (!isTerminal) return;
    fetch(`/api/runs/${runId}/logs`)
      .then((r) => r.json())
      .then((data: { lines: LogLine[] }) => setLogs(data.lines))
      .catch(console.error);
  }, [isTerminal, runId]);

  // SSE connection — only depends on runId and isTerminal (boolean), not the specific status string
  useEffect(() => {
    if (isTerminal !== false) return; // null = loading, true = already terminal

    const es = new EventSource(`/sse/runs/${runId}`);
    requestNotificationPermission();

    es.addEventListener("log", (e) => {
      try {
        const entry = JSON.parse(e.data) as LogLine;
        logBufferRef.current.push(entry);
        if (!rafRef.current) {
          rafRef.current = requestAnimationFrame(flushLogs);
        }
      } catch {
        console.warn("Failed to parse SSE log event:", e.data);
      }
    });

    es.addEventListener("step", (e) => {
      try {
        const stepData = JSON.parse(e.data) as { stepId: string; status: string };
        mutate(
          (prev) =>
            prev && {
              ...prev,
              steps: prev.steps.map((s) => (s.step_id === stepData.stepId ? { ...s, status: stepData.status as StepRow["status"] } : s)),
            },
          { revalidate: false },
        );
      } catch {
        console.warn("Failed to parse SSE step event:", e.data);
      }
    });

    es.addEventListener("run", (e) => {
      try {
        const { status } = JSON.parse(e.data) as { status: string };
        mutate((prev) => prev && { ...prev, run: { ...prev.run, status: status as RunRow["status"] } }, { revalidate: false });
        if (TERMINAL_STATUSES.has(status)) {
          showRunNotification(pipelineNameRef.current, status);
          if (rafRef.current) cancelAnimationFrame(rafRef.current);
          flushLogs();
          es.close();
        }
      } catch {
        console.warn("Failed to parse SSE run event:", e.data);
      }
    });

    es.onerror = () => {
      // Reconnection is handled by the browser's EventSource; close only if we know it's terminal
      mutate().then((data) => {
        if (data && TERMINAL_STATUSES.has(data.run.status)) es.close();
      });
    };

    return () => {
      es.close();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isTerminal, runId, flushLogs, mutate]);

  // Auto-follow: select the running step's logs
  useEffect(() => {
    if (!autoFollow) return;
    const runningStep = steps.find((s) => s.status === "running");
    if (runningStep) setSelectedStepId(runningStep.step_id);
  }, [steps, autoFollow]);

  const handleStepClick = (stepId: string) => {
    setAutoFollow(false);
    setSelectedStepId(selectedStepId === stepId ? null : stepId);
  };

  const handleShowAllLogs = () => {
    setAutoFollow(false);
    setSelectedStepId(null);
  };

  const handleRerun = () => {
    navigate(`/${ns}/${pipelineId}?rerun=${runId}`);
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
          toast("Pipeline already has an active run — wait for it to finish or cancel it first", "error");
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
        { revalidate: false },
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

  const breadcrumbs = [
    { label: nsDisplayName, href: `/${ns}` },
    { label: run?.pipeline_name ?? pipelineId, href: `/${ns}/${pipelineId}` },
    { label: `Run #${runId.slice(0, 8)}` },
  ];

  if (error) {
    return (
      <Layout breadcrumbs={breadcrumbs}>
        <div className="text-red-400">{error.message}</div>
      </Layout>
    );
  }

  if (!run) {
    return (
      <Layout breadcrumbs={breadcrumbs}>
        <RunSkeleton />
      </Layout>
    );
  }

  const isActive = run.status === "running" || run.status === "pending";

  return (
    <Layout breadcrumbs={breadcrumbs}>
      <div className="h-full flex flex-col">
        {/* Metadata bar */}
        <div className="flex items-center justify-between mb-4 pb-4 border-b border-neutral-800 shrink-0">
          <div className="flex items-center gap-3">
            <StatusBadge status={run.status} />
            <div>
              <h1 className="text-base font-semibold tracking-tight">{run.pipeline_name}</h1>
              <p className="text-xs text-neutral-500">
                <span className="font-mono" title={run.started_at}>
                  {timeAgo(run.started_at)}
                </span>
                {run.triggered_by && <span className="ml-2">by {run.triggered_by}</span>}
                {liveDuration && <span className="ml-2 font-mono text-white">{liveDuration}</span>}
              </p>
            </div>
            {run.dry_run === 1 && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-900/60 text-purple-300">
                DRY RUN
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {steps.length > 0 &&
              (() => {
                const done = steps.filter((s) => s.status === "success" || s.status === "failed" || s.status === "skipped").length;
                const runningStep = steps.find((s) => s.status === "running");
                if (runningStep) {
                  const idx = steps.indexOf(runningStep) + 1;
                  return (
                    <span className="text-xs text-neutral-400 font-mono">
                      {idx}/{steps.length}
                    </span>
                  );
                }
                return (
                  <span className="text-xs text-neutral-500 font-mono">
                    {done}/{steps.length}
                  </span>
                );
              })()}
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
              <Button onClick={handleRerun} icon={<RotateCcw size={14} />}>
                Re-run
              </Button>
            )}
            <Button onClick={handleDownloadLogs} icon={<Download size={14} />}>
              Logs
            </Button>
          </div>
        </div>

        {/* Error banner */}
        {run.error && (
          <div className="flex items-start gap-3 bg-red-950/50 border border-red-900/50 rounded-lg p-3 mb-4 shrink-0">
            <AlertCircle size={16} className="text-red-400 shrink-0 mt-0.5" />
            <div className="text-sm text-red-300">{run.error}</div>
          </div>
        )}

        {/* Side-by-side: Steps + Logs */}
        <div className="flex gap-4 flex-1 min-h-0">
          {/* Steps panel */}
          <div className="w-60 shrink-0 overflow-y-auto">
            <button
              type="button"
              onClick={handleShowAllLogs}
              className={`w-full text-left text-xs px-2.5 py-1.5 rounded-md transition-colors mb-2 ${
                selectedStepId === null ? "bg-white text-neutral-900 font-medium" : "bg-neutral-800/50 text-neutral-400 hover:text-white"
              }`}
            >
              All steps
            </button>

            {steps.map((step, i) => {
              const isLast = i === steps.length - 1;
              const isSelected = selectedStepId === step.step_id;
              const circleStyle = stepCircleStyles[step.status] ?? "border-neutral-800 bg-neutral-900";

              return (
                <div key={step.step_id} className="flex gap-2.5">
                  <div className="flex flex-col items-center">
                    <div className={`relative z-10 flex items-center justify-center w-6 h-6 rounded-full border-2 ${circleStyle}`}>
                      <StepIcon status={step.status} size={12} />
                    </div>
                    {!isLast && (
                      <div className={`w-0.5 flex-1 min-h-4 ${step.status === "success" ? "bg-green-800/50" : "bg-neutral-800"}`} />
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => handleStepClick(step.step_id)}
                    className={`pb-3 pt-0.5 flex-1 min-w-0 px-1.5 rounded-md transition-colors text-left ${
                      isSelected ? "bg-neutral-800/50 ring-1 ring-neutral-600/30" : "hover:bg-neutral-800/30"
                    }`}
                  >
                    <div className={`text-xs font-medium truncate ${step.status === "skipped" ? "text-neutral-600" : "text-neutral-200"}`}>
                      {step.step_name}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[10px] text-neutral-600 font-mono">{step.action}</span>
                      {step.started_at && step.finished_at && (
                        <span className="text-[10px] text-neutral-600 font-mono">{formatDuration(step.started_at, step.finished_at)}</span>
                      )}
                    </div>
                  </button>
                </div>
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
