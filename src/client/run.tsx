import { AlertCircle, Download, Square } from "lucide-react";
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
import { renderPage, useNsDisplayName } from "./swr.tsx";
import { formatTime, handleUnauthorized, requestNotificationPermission, showRunNotification } from "./utils.ts";

const stepCircleStyles: Record<string, string> = {
  running: "border-blue-500/50 bg-blue-950/50 shadow-[0_0_8px_rgba(59,130,246,0.3)]",
  success: "border-green-800/50 bg-green-950/30",
  failed: "border-red-800/50 bg-red-950/30",
};

function RunPage() {
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [cancelling, setCancelling] = useState(false);
  const [showStopConfirm, setShowStopConfirm] = useState(false);
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

  const segments = location.pathname.split("/");
  const ns = segments[1]!;
  const pipelineId = segments[2]!;
  const runId = segments[4]!;

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

  useEffect(() => {
    if (!run) return;

    if (TERMINAL_STATUSES.has(run.status)) {
      fetch(`/api/runs/${runId}/logs`)
        .then((r) => r.json())
        .then((data: { lines: LogLine[] }) => setLogs(data.lines))
        .catch(console.error);
      return;
    }

    const es = new EventSource(`/sse/runs/${runId}`);
    requestNotificationPermission();

    es.addEventListener("log", (e) => {
      const entry = JSON.parse(e.data) as LogLine;
      logBufferRef.current.push(entry);
      if (!rafRef.current) {
        rafRef.current = requestAnimationFrame(flushLogs);
      }
    });

    es.addEventListener("step", (e) => {
      const stepData = JSON.parse(e.data) as { stepId: string; status: string };
      mutate(
        (prev) =>
          prev && {
            ...prev,
            steps: prev.steps.map((s) => (s.step_id === stepData.stepId ? { ...s, status: stepData.status as StepRow["status"] } : s)),
          },
        { revalidate: false },
      );
    });

    es.addEventListener("run", (e) => {
      const { status } = JSON.parse(e.data) as { status: string };
      mutate((prev) => prev && { ...prev, run: { ...prev.run, status: status as RunRow["status"] } }, { revalidate: false });
      if (TERMINAL_STATUSES.has(status)) {
        showRunNotification(run.pipeline_name, status);
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        flushLogs();
        es.close();
      }
    });

    es.onerror = () => {
      if (run && TERMINAL_STATUSES.has(run.status)) {
        es.close();
      }
    };

    return () => {
      es.close();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [run?.status, runId, flushLogs, mutate]);

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
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-lg font-semibold">{run.pipeline_name}</h1>
            <p className="text-sm text-gray-500">
              {formatTime(run.started_at)}
              {run.triggered_by && <span className="ml-2">by {run.triggered_by}</span>}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {run.dry_run === 1 && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-900/60 text-purple-300">
                dry run
              </span>
            )}
            <StatusBadge status={run.status} />
            {isActive && (
              <Button variant="danger" onClick={() => setShowStopConfirm(true)} loading={cancelling} icon={<Square size={12} />}>
                Stop
              </Button>
            )}
            <Button onClick={handleDownloadLogs} icon={<Download size={14} />}>
              Download logs
            </Button>
          </div>
        </div>

        {run.error && (
          <div className="flex items-start gap-3 bg-red-950/50 border border-red-900/50 rounded-lg p-4 mb-4">
            <AlertCircle size={18} className="text-red-400 shrink-0 mt-0.5" />
            <div className="text-sm text-red-300">{run.error}</div>
          </div>
        )}

        <div className="mb-4">
          {steps.map((step, i) => {
            const isLast = i === steps.length - 1;

            const circleStyle = stepCircleStyles[step.status] ?? "border-gray-800 bg-gray-900";

            return (
              <div key={step.step_id} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div className={`relative z-10 flex items-center justify-center w-7 h-7 rounded-full border-2 ${circleStyle}`}>
                    <StepIcon status={step.status} size={14} />
                  </div>
                  {!isLast && <div className={`w-px flex-1 min-h-4 ${step.status === "success" ? "bg-green-800/50" : "bg-gray-800"}`} />}
                </div>

                <div className="pb-4 pt-1 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-medium ${step.status === "skipped" ? "text-gray-600" : "text-gray-200"}`}>
                      {step.step_name}
                    </span>
                    <span className="text-[10px] text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded font-mono">{step.action}</span>
                    {step.status !== "pending" && step.status !== "skipped" && <StatusBadge status={step.status} />}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <LogViewer lines={logs} />

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
      </div>
    </Layout>
  );
}

renderPage(RunPage);
