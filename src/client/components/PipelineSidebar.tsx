import { useConfigs } from "../hooks.tsx";
import { Link } from "../router.tsx";
import { useSidebar } from "../utils.ts";
import { NamespaceNav } from "./NamespaceNav.tsx";

interface PipelineSidebarProps {
  ns: string;
  pipelineId: string;
  active: "runs" | "config";
}

const tabBase = "block px-2 py-1 text-xs rounded-lg no-underline transition-colors";
const tabActive = `${tabBase} bg-white/[0.08] text-white font-medium`;
const tabInactive = `${tabBase} text-neutral-500 hover:text-neutral-300 hover:bg-white/[0.04]`;

const pipelineBase = "block px-2 py-1.5 text-sm rounded-lg no-underline transition-colors truncate";
const pipelineActive = `${pipelineBase} text-white font-medium`;
const pipelineInactive = `${pipelineBase} text-neutral-500 hover:text-neutral-300 hover:bg-white/[0.04]`;

export function PipelineSidebar({ ns, pipelineId, active }: PipelineSidebarProps) {
  const { collapsed } = useSidebar();
  const { data: configs } = useConfigs();

  if (collapsed) {
    return <NamespaceNav current={ns} />;
  }

  const nsConfig = configs?.find((c) => c.namespace === ns);
  const pipelines = nsConfig?.pipelines ?? [];

  return (
    <NamespaceNav current={ns}>
      {pipelines.map((p) => {
        const isCurrent = p.id === pipelineId;
        return (
          <div key={p.id}>
            <Link to={`/${ns}/${p.id}`} className={isCurrent ? pipelineActive : pipelineInactive}>
              {p.name}
            </Link>
            {isCurrent && (
              <div className="ml-4 space-y-0.5 mt-0.5 mb-1">
                <Link to={`/${ns}/${pipelineId}`} className={active === "runs" ? tabActive : tabInactive}>
                  Runs
                </Link>
                <Link to={`/${ns}/${pipelineId}/config`} className={active === "config" ? tabActive : tabInactive}>
                  Config
                </Link>
              </div>
            )}
          </div>
        );
      })}
    </NamespaceNav>
  );
}
