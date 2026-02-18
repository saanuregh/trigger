import { Link } from "../router.tsx";

interface PipelineSidebarProps {
  ns: string;
  pipelineId: string;
  active: "runs" | "config";
}

const base = "block px-3 py-1.5 text-sm rounded-md no-underline border-l-2 transition-colors";
const activeStyle = `${base} bg-neutral-800 text-white border-neutral-400`;
const inactiveStyle = `${base} text-neutral-400 hover:text-white hover:bg-neutral-800 border-transparent`;

export function PipelineSidebar({ ns, pipelineId, active }: PipelineSidebarProps) {
  return (
    <nav className="space-y-1">
      <Link to={`/${ns}/${pipelineId}`} className={active === "runs" ? activeStyle : inactiveStyle}>
        Runs
      </Link>
      <Link to={`/${ns}/${pipelineId}/config`} className={active === "config" ? activeStyle : inactiveStyle}>
        Config
      </Link>
    </nav>
  );
}
