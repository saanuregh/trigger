import type { ReactNode } from "react";
import { useConfigs } from "../hooks.tsx";
import { Link } from "../router.tsx";
import { nsColor, useSidebar } from "../utils.ts";

export function NamespaceNav({ current, children }: { current: string; children?: ReactNode }) {
  const { data: configs } = useConfigs();
  const { collapsed } = useSidebar();

  if (!configs || configs.length === 0) return null;

  return (
    <div className="space-y-0.5">
      {configs.map((c) => {
        if (c.error) return null;
        const isCurrent = c.namespace === current;
        const color = nsColor(c.namespace);

        if (collapsed) {
          return (
            <div key={c.namespace} className="group relative">
              <Link
                to={`/${c.namespace}`}
                className={`flex items-center justify-center w-8 h-8 rounded-lg no-underline transition-colors mx-auto ${
                  isCurrent ? `bg-white/[0.06] border-l-2 ${color.border}` : "hover:bg-white/[0.04]"
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${color.dot} shrink-0`} />
              </Link>
              <div className="sidebar-tooltip">{c.display_name}</div>
            </div>
          );
        }

        return (
          <div key={c.namespace}>
            <Link
              to={`/${c.namespace}`}
              className={`flex items-center gap-2 px-2 py-1.5 text-sm rounded-lg no-underline transition-colors ${
                isCurrent
                  ? `bg-white/[0.06] text-white font-medium border-l-2 ${color.border}`
                  : "text-neutral-400 hover:text-white hover:bg-white/[0.04]"
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${color.dot} shrink-0`} />
              <span className="truncate">{c.display_name}</span>
            </Link>
            {isCurrent && children && <div className="ml-[11px] pl-3 border-l border-white/[0.06] mt-0.5 mb-1 space-y-0.5">{children}</div>}
          </div>
        );
      })}
    </div>
  );
}
