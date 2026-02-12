import { useState } from "react";
import { errorMessage, type ParamDef, type PipelineDefSummary } from "../../types.ts";
import { AlertCircle } from "lucide-react";
import { Button } from "./Button.tsx";
import { ConfirmDialog } from "./ConfirmDialog.tsx";

function defaultParams(params: ParamDef[]): Record<string, string | boolean> {
  const defaults: Record<string, string | boolean> = {};
  for (const p of params) {
    if (p.type === "boolean") {
      defaults[p.name] = p.default ?? false;
    } else {
      defaults[p.name] = p.default ?? "";
    }
  }
  return defaults;
}

const inputBase =
  "w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/30 transition-colors";

function ParamField({
  param,
  value,
  onChange,
}: {
  param: ParamDef;
  value: string | boolean;
  onChange: (value: string | boolean) => void;
}) {
  if (param.type === "boolean") {
    return (
      <label className="inline-flex items-center gap-2.5 text-sm cursor-pointer group">
        <input
          type="checkbox"
          checked={value as boolean}
          onChange={(e) => onChange(e.target.checked)}
          className="w-4 h-4 rounded bg-gray-800 border-gray-600 text-blue-600 focus:ring-blue-500/30 focus:ring-offset-0"
        />
        <span className="text-gray-300 group-hover:text-gray-200 transition-colors">{param.label}</span>
      </label>
    );
  }

  if (param.type === "select") {
    return (
      <div>
        <label className="block text-sm text-gray-400 mb-1.5 font-medium">{param.label}</label>
        <select
          value={value as string}
          onChange={(e) => onChange(e.target.value)}
          className={inputBase}
        >
          {param.options.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div>
      <label className="block text-sm text-gray-400 mb-1.5 font-medium">
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

interface ParamFormProps {
  pipeline: PipelineDefSummary;
  ns: string;
  onRunStarted: (runId: string) => void;
}

export function ParamForm({ pipeline, ns, onRunStarted }: ParamFormProps) {
  const [params, setParams] = useState<Record<string, string | boolean>>(
    () => defaultParams(pipeline.params ?? []),
  );
  const [dryRun, setDryRun] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);

  const doRun = async () => {
    setSubmitting(true);
    setError("");
    setShowConfirm(false);

    try {
      const res = await fetch(`/api/pipelines/${ns}/${pipeline.id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ params, dryRun }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Request failed" }));
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      const { runId } = (await res.json()) as { runId: string };
      onRunStarted(runId);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (pipeline.confirm && !dryRun) {
      setShowConfirm(true);
      return;
    }

    await doRun();
  };

  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-3">
        {(pipeline.params ?? []).map((param) => (
          <ParamField
            key={param.name}
            param={param}
            value={params[param.name] ?? (param.type === "boolean" ? false : "")}
            onChange={(val) => setParams((prev) => ({ ...prev, [param.name]: val }))}
          />
        ))}

        <div className="flex items-center gap-3 pt-1">
          <Button variant="primary" size="md" type="submit" loading={submitting}>
            {pipeline.confirm && !dryRun ? "Confirm & Run" : "Run Pipeline"}
          </Button>
          <label className="inline-flex items-center gap-2 text-sm text-gray-400 select-none cursor-pointer group">
            <input
              type="checkbox"
              checked={dryRun}
              onChange={(e) => setDryRun(e.target.checked)}
              className="w-4 h-4 rounded bg-gray-800 border-gray-600 text-blue-600 focus:ring-blue-500/30 focus:ring-offset-0"
            />
            <span className="group-hover:text-gray-300 transition-colors">Dry run</span>
          </label>
          {pipeline.confirm && !dryRun && (
            <span className="text-xs text-yellow-500">Requires confirmation</span>
          )}
        </div>

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
}
