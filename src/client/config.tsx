import { Check, ChevronDown, ChevronRight, Copy } from "lucide-react";
import { useState } from "react";
import type { ActionName, PipelineConfigResponse } from "../types.ts";
import { Card } from "./components/Card.tsx";
import { ErrorMessage } from "./components/ErrorMessage.tsx";
import { Layout } from "./components/Layout.tsx";
import { PipelineSidebar } from "./components/PipelineSidebar.tsx";
import { SectionHeader } from "./components/SectionHeader.tsx";
import { ConfigSkeleton } from "./components/Skeleton.tsx";
import { useFetch, useNsDisplayName } from "./hooks.tsx";
import { useRoute } from "./router.tsx";
import { hashString } from "./utils.ts";

const TEMPLATE_SPLIT_RE = /(\{\{.+?\}\})/g;
const TEMPLATE_TEST_RE = /^\{\{.+?\}\}$/;

const ACTION_COLOR_PALETTE = [
  { bg: "bg-teal-500/15", text: "text-teal-300" },
  { bg: "bg-amber-500/15", text: "text-amber-300" },
  { bg: "bg-violet-500/15", text: "text-violet-300" },
  { bg: "bg-rose-500/15", text: "text-rose-300" },
  { bg: "bg-sky-500/15", text: "text-sky-300" },
  { bg: "bg-lime-500/15", text: "text-lime-300" },
  { bg: "bg-orange-500/15", text: "text-orange-300" },
  { bg: "bg-pink-500/15", text: "text-pink-300" },
  { bg: "bg-cyan-500/15", text: "text-cyan-300" },
  { bg: "bg-indigo-500/15", text: "text-indigo-300" },
  { bg: "bg-fuchsia-500/15", text: "text-fuchsia-300" },
  { bg: "bg-emerald-500/15", text: "text-emerald-300" },
] as const;

function getActionColor(action: ActionName): string {
  const color = ACTION_COLOR_PALETTE[hashString(action) % ACTION_COLOR_PALETTE.length]!;
  return `${color.bg} ${color.text}`;
}

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

function StepCard({ step, index }: { step: PipelineConfigResponse["steps"][number]; index: number }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <Card>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 p-3 text-left hover:bg-white/[0.04] transition-colors rounded-lg"
      >
        {expanded ? (
          <ChevronDown size={14} className="text-neutral-500 shrink-0" />
        ) : (
          <ChevronRight size={14} className="text-neutral-500 shrink-0" />
        )}
        <span className="text-xs text-neutral-600 w-5 text-right">{index + 1}.</span>
        <span className="text-sm font-medium text-neutral-200">{step.name}</span>
        <span className={`text-xs px-1.5 py-0.5 rounded-lg font-mono ${getActionColor(step.action)}`}>{step.action}</span>
      </button>
      {expanded && (
        <div className="px-3 pb-3 ml-7 space-y-1 border-t border-white/[0.04] pt-2">
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

  const { data: config, error } = useFetch<PipelineConfigResponse>(`/api/pipelines/${ns}/${pipelineId}/config`);
  const nsDisplayName = useNsDisplayName(ns);

  const sidebar = <PipelineSidebar ns={ns} pipelineId={pipelineId} active="config" />;

  if (error) {
    return (
      <Layout sidebar={sidebar}>
        <ErrorMessage>{error.message}</ErrorMessage>
      </Layout>
    );
  }

  if (!config) {
    return (
      <Layout sidebar={sidebar}>
        <ConfigSkeleton />
      </Layout>
    );
  }

  return (
    <Layout
      sidebar={sidebar}
      breadcrumbs={[{ label: nsDisplayName, to: `/${ns}` }, { label: config.name, to: `/${ns}/${pipelineId}` }, { label: "Config" }]}
    >
      <div className="space-y-4">
        {config.description && <p className="text-sm text-neutral-400">{config.description}</p>}

        {config.params && config.params.length > 0 && (
          <div>
            <SectionHeader className="mb-2">Parameters</SectionHeader>
            <div className="bg-neutral-900/50 border border-white/[0.06] rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-neutral-500 text-xs font-medium">
                    <th className="px-3 py-1.5">Name</th>
                    <th className="px-3 py-1.5">Type</th>
                    <th className="px-3 py-1.5">Default</th>
                    <th className="px-3 py-1.5">Required</th>
                  </tr>
                </thead>
                <tbody>
                  {config.params.map((p) => (
                    <tr key={p.name} className="border-t border-white/[0.04]">
                      <td className="px-3 py-1.5 text-neutral-200">{p.label}</td>
                      <td className="px-3 py-1.5">
                        <span className="text-xs bg-white/[0.06] text-neutral-400 px-1.5 py-0.5 rounded-lg font-mono">{p.type}</span>
                      </td>
                      <td className="px-3 py-1.5">
                        <ConfigValue value={p.default} />
                      </td>
                      <td className="px-3 py-1.5 text-neutral-400">
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
          <SectionHeader className="mb-2">Steps</SectionHeader>
          <div className="space-y-1.5">
            {config.steps.map((step, i) => (
              <StepCard key={step.id} step={step} index={i} />
            ))}
          </div>
        </div>
      </div>
    </Layout>
  );
}
