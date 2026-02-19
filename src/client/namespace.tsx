import { GitBranch } from "lucide-react";
import type { PaginatedResponse, PipelineDefSummary, RunRow } from "../types.ts";
import { EmptyState } from "./components/EmptyState.tsx";
import { ErrorMessage } from "./components/ErrorMessage.tsx";
import { Layout } from "./components/Layout.tsx";
import { NamespaceNav } from "./components/NamespaceNav.tsx";
import { NamespaceSkeleton } from "./components/Skeleton.tsx";
import { StatusDot } from "./components/StatusBadge.tsx";
import { useConfigs, useFetch } from "./hooks.tsx";
import { FocusList, focusRingClass } from "./keyboard.tsx";
import { Link, navigate, useRoute } from "./router.tsx";
import { formatDuration, timeAgo } from "./utils.ts";
import { useGlobalEvents } from "./ws.tsx";

function PipelineRow({
  ns,
  pipeline,
  focused,
  lastRun,
}: {
  ns: string;
  pipeline: PipelineDefSummary;
  focused: boolean;
  lastRun: RunRow | undefined;
}) {
  return (
    <Link
      to={`/${ns}/${pipeline.id}`}
      className={`flex items-center gap-3 px-3 py-1.5 hover:bg-white/[0.04] transition-colors no-underline ${focusRingClass(focused)}`}
    >
      <div className="flex-1 min-w-0">
        <span className="text-sm text-neutral-200 font-medium">{pipeline.name}</span>
        {pipeline.description && <div className="text-xs text-neutral-500 mt-0.5">{pipeline.description}</div>}
      </div>
      <span className="shrink-0">
        {lastRun ? <StatusDot status={lastRun.status} /> : <span className="text-xs text-neutral-600">-</span>}
      </span>
      <span className="text-xs text-neutral-500 shrink-0 w-16">
        {lastRun ? (
          <span title={`${lastRun.started_at}${lastRun.triggered_by ? ` by ${lastRun.triggered_by}` : ""}`}>
            {timeAgo(lastRun.started_at)}
          </span>
        ) : (
          <span className="text-neutral-600">-</span>
        )}
      </span>
      <span className="text-xs text-neutral-500 font-mono shrink-0 w-12">
        {lastRun?.finished_at ? formatDuration(lastRun.started_at, lastRun.finished_at) : lastRun ? "..." : "-"}
      </span>
    </Link>
  );
}

export function NamespacePage() {
  const { ns } = useRoute().params as { ns: string };

  const { data: configs, error: configsError } = useConfigs();
  const nsConfig = configs?.find((c) => c.namespace === ns);

  const { data: runsData, mutate: mutateRuns } = useFetch<PaginatedResponse<RunRow>>(`/api/runs?ns=${ns}&per_page=100`);

  useGlobalEvents((event) => {
    if (event.namespace === ns) mutateRuns();
  });

  const latestRuns = new Map<string, RunRow>();
  for (const run of runsData?.data ?? []) {
    if (!latestRuns.has(run.pipeline_id)) latestRuns.set(run.pipeline_id, run);
  }

  let error = "";
  if (configsError) error = "Failed to load configs";
  else if (configs && !nsConfig) error = "Namespace not found";

  if (error) {
    return (
      <Layout>
        <ErrorMessage>{error}</ErrorMessage>
      </Layout>
    );
  }

  if (!nsConfig) {
    return (
      <Layout>
        <NamespaceSkeleton />
      </Layout>
    );
  }

  return (
    <Layout sidebar={<NamespaceNav current={ns} />} breadcrumbs={[{ label: nsConfig.display_name }]}>
      <div>
        {nsConfig.pipelines.length === 0 ? (
          <EmptyState icon={<GitBranch size={48} />} title="No pipelines" description="This namespace has no pipelines configured." />
        ) : (
          <div className="bg-neutral-900/50 border border-white/[0.06] rounded-lg overflow-hidden">
            <div className="flex items-center gap-3 px-3 py-1.5 text-left text-neutral-500 text-xs font-medium border-b border-white/[0.04]">
              <span className="flex-1">Pipeline</span>
              <span className="shrink-0 w-6">Status</span>
              <span className="shrink-0 w-16">Last Run</span>
              <span className="shrink-0 w-12">Duration</span>
            </div>
            <FocusList items={nsConfig.pipelines} onSelect={(p) => navigate(`/${ns}/${p.id}`)} className="divide-y divide-white/[0.04]">
              {(p, focused) => <PipelineRow key={p.id} ns={ns} pipeline={p} focused={focused} lastRun={latestRuns.get(p.id)} />}
            </FocusList>
          </div>
        )}
      </div>
    </Layout>
  );
}
