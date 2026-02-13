interface PipelineSidebarProps {
  ns: string;
  pipelineId: string;
  active: "runs" | "config";
}

const base = "block px-3 py-1.5 text-sm rounded-md no-underline border-l-2 transition-colors";
const activeStyle = `${base} bg-gray-800 text-white border-blue-500`;
const inactiveStyle = `${base} text-gray-400 hover:text-white hover:bg-gray-800 border-transparent`;

export function PipelineSidebar({ ns, pipelineId, active }: PipelineSidebarProps) {
  return (
    <nav className="space-y-1">
      <a href={`/${ns}/${pipelineId}`} className={active === "runs" ? activeStyle : inactiveStyle}>
        Runs
      </a>
      <a href={`/${ns}/${pipelineId}/config`} className={active === "config" ? activeStyle : inactiveStyle}>
        Config
      </a>
    </nav>
  );
}
