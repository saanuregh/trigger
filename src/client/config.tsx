import { Check, ChevronDown, ChevronRight, Copy } from "lucide-react";
import { useState } from "react";
import type { ParamDef } from "../types.ts";
import { Card } from "./components/Card.tsx";
import { Layout } from "./components/Layout.tsx";
import { PipelineSidebar } from "./components/PipelineSidebar.tsx";
import { useConfigs, useFetch } from "./hooks.tsx";
import { useRoute } from "./router.tsx";

interface StepConfig {
  id: string;
  name: string;
  action: string;
  config: Record<string, unknown>;
}

interface PipelineConfig {
  id: string;
  name: string;
  description?: string;
  params?: ParamDef[];
  steps: StepConfig[];
}

const TEMPLATE_SPLIT_RE = /(\{\{.+?\}\})/g;
const TEMPLATE_TEST_RE = /^\{\{.+?\}\}$/;

const actionColors: Record<string, string> = {
  codebuild: "bg-orange-500/15 text-orange-300",
  "ecs-task": "bg-white/[0.06] text-neutral-300",
  "cloudflare-purge": "bg-amber-500/15 text-amber-300",
};
const defaultActionColor = "bg-white/[0.06] text-neutral-400";

function TemplateString({ value }: { value: string }) {
  const parts = value.split(TEMPLATE_SPLIT_RE);
  if (parts.length === 1) {
    return <span className="text-green-400">"{value}"</span>;
  }
  return (
    <span>
      "
      {parts.map((part, i) =>
        TEMPLATE_TEST_RE.test(part) ? (
          <span key={i} className="text-purple-400 font-medium">
            {part}
          </span>
        ) : (
          <span key={i} className="text-green-400">
            {part}
          </span>
        ),
      )}
      "
    </span>
  );
}

function SwitchView({ value }: { value: Record<string, unknown> }) {
  const param = value.$switch as string;
  const cases = (value.cases ?? {}) as Record<string, unknown>;
  const defaultCase = value.default;

  return (
    <div className="text-sm space-y-1">
      <div className="text-purple-400">
        $switch on <span className="font-medium">"{param}"</span>
      </div>
      <div className="ml-4 space-y-1">
        {Object.entries(cases).map(([key, val]) => (
          <div key={key} className="flex gap-2">
            <span className="text-yellow-400 shrink-0">"{key}":</span>
            <ConfigValue value={val} />
          </div>
        ))}
        {defaultCase !== undefined && (
          <div className="flex gap-2">
            <span className="text-neutral-500 italic shrink-0">default:</span>
            <ConfigValue value={defaultCase} />
          </div>
        )}
      </div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center text-neutral-600 hover:text-neutral-400 transition-colors p-0.5"
      title="Copy value"
    >
      {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
    </button>
  );
}

function ConfigValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="text-neutral-600">-</span>;
  if (typeof value === "boolean") return <span className="text-yellow-400">{String(value)}</span>;
  if (typeof value === "number") return <span className="text-neutral-300">{value}</span>;
  if (typeof value === "string") return <TemplateString value={value} />;
  if (Array.isArray(value)) {
    return (
      <span className="text-neutral-300">
        [
        {value.map((v, i) => (
          <span key={i}>
            {i > 0 && ", "}
            <ConfigValue value={v} />
          </span>
        ))}
        ]
      </span>
    );
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if ("$switch" in obj) return <SwitchView value={obj} />;
    return <pre className="text-neutral-300 text-xs bg-white/[0.04] rounded-lg p-2 mt-1">{JSON.stringify(value, null, 2)}</pre>;
  }
  return <span className="text-green-400">"{String(value)}"</span>;
}

function StepCard({ step, index }: { step: StepConfig; index: number }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <Card>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 p-4 text-left hover:bg-white/[0.04] transition-colors rounded-lg"
      >
        {expanded ? (
          <ChevronDown size={14} className="text-neutral-500 shrink-0" />
        ) : (
          <ChevronRight size={14} className="text-neutral-500 shrink-0" />
        )}
        <span className="text-xs text-neutral-600 w-5 text-right">{index + 1}.</span>
        <span className="text-sm font-medium text-neutral-200">{step.name}</span>
        <span className={`text-[11px] px-1.5 py-0.5 rounded-lg font-mono ${actionColors[step.action] ?? defaultActionColor}`}>
          {step.action}
        </span>
      </button>
      {expanded && (
        <div className="px-4 pb-4 ml-9 space-y-1.5 border-t border-white/[0.04] pt-3">
          {Object.entries(step.config).map(([key, val]) => (
            <div key={key} className="text-sm flex items-start gap-2 group">
              <span className="text-neutral-500 shrink-0">{key}:</span>
              <ConfigValue value={val} />
              {typeof val === "string" && (
                <span className="opacity-0 group-hover:opacity-100 transition-opacity">
                  <CopyButton text={val} />
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export function ConfigPage() {
  const { ns, pipelineId } = useRoute().params as { ns: string; pipelineId: string };

  const { data: config, error } = useFetch<PipelineConfig>(`/api/pipelines/${ns}/${pipelineId}/config`);
  const { data: configs } = useConfigs();
  const nsDisplayName = configs?.find((c) => c.namespace === ns)?.display_name ?? ns;

  const sidebar = <PipelineSidebar ns={ns} pipelineId={pipelineId} active="config" />;

  if (error) {
    return (
      <Layout sidebar={sidebar}>
        <div className="text-red-400">{error.message}</div>
      </Layout>
    );
  }

  if (!config) {
    return (
      <Layout sidebar={sidebar}>
        <div className="text-neutral-500">Loading...</div>
      </Layout>
    );
  }

  return (
    <Layout
      sidebar={sidebar}
      breadcrumbs={[{ label: nsDisplayName, to: `/${ns}` }, { label: config.name, to: `/${ns}/${pipelineId}` }, { label: "Config" }]}
    >
      <div className="space-y-6">
        {config.description && <p className="text-sm text-neutral-400">{config.description}</p>}

        {config.params && config.params.length > 0 && (
          <div>
            <h2 className="text-[11px] font-medium text-neutral-500 uppercase tracking-wider mb-3">Parameters</h2>
            <div className="bg-neutral-900/50 border border-white/[0.06] rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-neutral-500 text-[11px] font-medium">
                    <th className="px-4 py-2.5">Name</th>
                    <th className="px-4 py-2.5">Type</th>
                    <th className="px-4 py-2.5">Default</th>
                    <th className="px-4 py-2.5">Required</th>
                  </tr>
                </thead>
                <tbody>
                  {config.params.map((p) => (
                    <tr key={p.name} className="border-t border-white/[0.04]">
                      <td className="px-4 py-2.5 text-neutral-200">{p.label}</td>
                      <td className="px-4 py-2.5">
                        <span className="text-xs bg-white/[0.06] text-neutral-400 px-1.5 py-0.5 rounded-lg font-mono">{p.type}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        <ConfigValue value={p.default} />
                      </td>
                      <td className="px-4 py-2.5 text-neutral-400">
                        {"required" in p && p.required ? (
                          <span className="text-xs bg-red-500/15 text-red-400 px-1.5 py-0.5 rounded-lg">Yes</span>
                        ) : (
                          "-"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div>
          <h2 className="text-[11px] font-medium text-neutral-500 uppercase tracking-wider mb-3">Steps</h2>
          <div className="space-y-2">
            {config.steps.map((step, i) => (
              <StepCard key={step.id} step={step} index={i} />
            ))}
          </div>
        </div>
      </div>
    </Layout>
  );
}
