import { Link } from "../router.tsx";
import { NamespaceNav } from "./NamespaceNav.tsx";

interface PipelineSidebarProps {
  ns: string;
  pipelineId: string;
  pipelineName: string;
  active: "runs" | "config";
}

const base = "block px-2 py-1 text-sm rounded-lg no-underline transition-colors";
const activeStyle = `${base} bg-white/[0.08] text-white font-medium`;
const inactiveStyle = `${base} text-neutral-400 hover:text-white hover:bg-white/[0.04]`;

export function PipelineSidebar({ ns, pipelineId, pipelineName, active }: PipelineSidebarProps) {
  return (
    <NamespaceNav current={ns}>
      <div className="text-sm text-neutral-300 font-medium truncate px-2 pt-0.5 pb-1">{pipelineName}</div>
      <Link to={`/${ns}/${pipelineId}`} className={active === "runs" ? activeStyle : inactiveStyle}>
        Runs
      </Link>
      <Link to={`/${ns}/${pipelineId}/config`} className={active === "config" ? activeStyle : inactiveStyle}>
        Config
      </Link>
    </NamespaceNav>
  );
}
