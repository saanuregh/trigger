import { GitBranch } from "lucide-react";
import type { PaginatedResponse, RunRow } from "../types.ts";
import { EmptyState } from "./components/EmptyState.tsx";
import { ErrorMessage } from "./components/ErrorMessage.tsx";
import { Layout } from "./components/Layout.tsx";
import { NamespaceNav } from "./components/NamespaceNav.tsx";
import { NamespaceSkeleton } from "./components/Skeleton.tsx";
import { StatusDot } from "./components/StatusBadge.tsx";
import { useConfigs, useFetch } from "./hooks.tsx";
import { Link, useRoute } from "./router.tsx";
import { formatDuration, timeAgo } from "./utils.ts";
import { useGlobalEvents } from "./ws.tsx";

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
          <div className="bg-neutral-900/50 border border-white/[0.06] rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-neutral-500 text-xs font-medium">
                  <th className="px-3 py-1.5">Pipeline</th>
                  <th className="px-3 py-1.5">Status</th>
                  <th className="px-3 py-1.5">Last Run</th>
                  <th className="px-3 py-1.5 w-20">Duration</th>
                </tr>
              </thead>
              <tbody>
                {nsConfig.pipelines.map((p) => {
                  const lastRun = latestRuns.get(p.id);
                  return (
                    <tr key={p.id} className="border-t border-white/[0.04] hover:bg-white/[0.04] transition-colors relative">
                      <td className="px-3 py-1.5">
                        <Link
                          to={`/${ns}/${p.id}`}
                          className="text-neutral-200 hover:text-white no-underline font-medium after:absolute after:inset-0"
                        >
                          {p.name}
                        </Link>
                        {p.description && <div className="text-xs text-neutral-500 mt-0.5">{p.description}</div>}
                      </td>
                      <td className="px-3 py-1.5">
                        {lastRun ? <StatusDot status={lastRun.status} /> : <span className="text-xs text-neutral-600">-</span>}
                      </td>
                      <td className="px-3 py-1.5 text-neutral-500 text-xs">
                        {lastRun ? (
                          <span title={`${lastRun.started_at}${lastRun.triggered_by ? ` by ${lastRun.triggered_by}` : ""}`}>
                            {timeAgo(lastRun.started_at)}
                          </span>
                        ) : (
                          <span className="text-neutral-600">-</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-neutral-500 text-xs font-mono">
                        {lastRun?.finished_at ? formatDuration(lastRun.started_at, lastRun.finished_at) : lastRun ? "..." : "-"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Layout>
  );
}
