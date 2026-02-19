import { AlertCircle } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { errorMessage, type ParamDef, type PipelineDefSummary, type RunIdResponse, type RunRow } from "../../types.ts";
import { handleUnauthorized, isMac } from "../utils.ts";
import { Button } from "./Button.tsx";
import { ConfirmDialog } from "./ConfirmDialog.tsx";

function defaultParams(params: ParamDef[]): Record<string, string | boolean> {
  const defaults: Record<string, string | boolean> = {};
  for (const p of params) {
    if (p.type === "boolean") {
      defaults[p.name] = p.default ?? false;
    } else if (p.type === "select" && p.default === undefined && p.options.length > 0) {
      defaults[p.name] = p.options[0]!.value;
    } else {
      defaults[p.name] = p.default ?? "";
    }
  }
  return defaults;
}

const inputBase =
  "w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-2.5 py-1 text-sm text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-white/[0.2] focus:ring-1 focus:ring-white/[0.08] transition-colors";

function ParamField({ param, value, onChange }: { param: ParamDef; value: string | boolean; onChange: (value: string | boolean) => void }) {
  if (param.type === "boolean") {
    return (
      <label className="inline-flex items-center gap-2.5 text-sm cursor-pointer group">
        <input
          type="checkbox"
          checked={value as boolean}
          onChange={(e) => onChange(e.target.checked)}
          className="w-4 h-4 rounded bg-white/[0.04] border-white/[0.08] text-white focus:ring-white/[0.08] focus:ring-offset-0"
        />
        <span className="text-neutral-300 group-hover:text-neutral-200 transition-colors">{param.label}</span>
      </label>
    );
  }

  if (param.type === "select") {
    return (
      <div>
        <label className="block text-sm text-neutral-400 mb-1 font-medium">{param.label}</label>
        <select value={value as string} onChange={(e) => onChange(e.target.value)} className={inputBase}>
          {param.options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div>
      <label className="block text-sm text-neutral-400 mb-1 font-medium">
        {param.label}
        {param.required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      <input
        type="text"
        value={value as string}
        onChange={(e) => onChange(e.target.value)}
        placeholder={param.placeholder ?? ""}
        className={inputBase}
      />
    </div>
  );
}

export interface ParamFormHandle {
  triggerRun: () => void;
  triggerDryRun: () => void;
}

interface ParamFormProps {
  pipeline: PipelineDefSummary;
  ns: string;
  onRunStarted: (runId: string) => void;
  rerunId?: string | null;
  activeRunCount?: number;
  atGlobalLimit?: boolean;
}

export const ParamForm = forwardRef<ParamFormHandle, ParamFormProps>(function ParamForm(
  { pipeline, ns, onRunStarted, rerunId, activeRunCount = 0, atGlobalLimit = false },
  ref,
) {
  const [params, setParams] = useState<Record<string, string | boolean>>(() => defaultParams(pipeline.params ?? []));
  const dryRunRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const isDirtyRef = useRef(false);

  useImperativeHandle(ref, () => ({
    triggerRun: () => {
      dryRunRef.current = false;
      formRef.current?.requestSubmit();
    },
    triggerDryRun: () => {
      dryRunRef.current = true;
      formRef.current?.requestSubmit();
    },
  }));

  // Track dirty state for beforeunload warning
  useEffect(() => {
    const defaults = defaultParams(pipeline.params ?? []);
    isDirtyRef.current = JSON.stringify(params) !== JSON.stringify(defaults);
  }, [params, pipeline.params]);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirtyRef.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  useEffect(() => {
    setParams(defaultParams(pipeline.params ?? []));
    setError("");
  }, [pipeline.id]);

  useEffect(() => {
    if (!rerunId) return;
    fetch(`/api/runs/${rerunId}`)
      .then((r) => r.json())
      .then((data: { run: RunRow }) => {
        if (data.run.params) {
          try {
            const parsed = JSON.parse(data.run.params) as Record<string, string | boolean>;
            setParams((prev) => ({ ...prev, ...parsed }));
          } catch {
            // ignore invalid JSON
          }
        }
      })
      .catch(() => {});
  }, [rerunId]);

  const doRun = async () => {
    setSubmitting(true);
    setError("");
    setShowConfirm(false);
    const dryRun = dryRunRef.current;

    try {
      const res = await fetch(`/api/pipelines/${ns}/${pipeline.id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ params, dryRun }),
      });

      if (handleUnauthorized(res)) return;
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Request failed" }));
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      const { runId } = (await res.json()) as RunIdResponse;
      onRunStarted(runId);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
      dryRunRef.current = false;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (pipeline.confirm && !dryRunRef.current) {
      setShowConfirm(true);
      return;
    }

    await doRun();
  };

  return (
    <>
      <form ref={formRef} onSubmit={handleSubmit} className="space-y-2">
        {(pipeline.params ?? []).map((param) => (
          <ParamField
            key={param.name}
            param={param}
            value={params[param.name] ?? (param.type === "boolean" ? false : "")}
            onChange={(val) => setParams((prev) => ({ ...prev, [param.name]: val }))}
          />
        ))}

        <div className="flex items-center gap-3">
          <Button
            variant="primary"
            size="md"
            type="submit"
            loading={submitting}
            disabled={activeRunCount >= pipeline.concurrency || atGlobalLimit}
          >
            Run Pipeline
            <kbd className="hidden sm:inline text-[11px] opacity-60 ml-1.5 bg-white/10 px-1.5 py-0.5 rounded">
              {isMac ? "\u2318\u23CE" : "Ctrl+\u23CE"}
            </kbd>
          </Button>
          {atGlobalLimit ? (
            <span className="text-xs text-yellow-500/80">Global concurrency limit reached.</span>
          ) : activeRunCount >= pipeline.concurrency ? (
            <span className="text-xs text-yellow-500/80">
              At max concurrency ({activeRunCount}/{pipeline.concurrency}).
            </span>
          ) : (
            pipeline.confirm && <span className="text-xs text-yellow-500/80">Requires confirmation.</span>
          )}
        </div>

        <div className="text-xs text-neutral-600">{isMac ? "\u21E7\u2318\u23CE" : "Shift+Ctrl+\u23CE"} for dry run</div>

        {error && (
          <div className="flex items-center gap-2 text-red-400 text-sm">
            <AlertCircle size={14} />
            {error}
          </div>
        )}
      </form>

      <ConfirmDialog
        open={showConfirm}
        onCancel={() => setShowConfirm(false)}
        onConfirm={doRun}
        title={`Run "${pipeline.name}"?`}
        description="This action cannot be undone. The pipeline will execute with the configured parameters."
        confirmLabel="Run Pipeline"
        variant="danger"
        loading={submitting}
      />
    </>
  );
});
