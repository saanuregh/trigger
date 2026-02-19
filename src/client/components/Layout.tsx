import { Loader2, LogOut, Workflow } from "lucide-react";
import type { ReactNode } from "react";
import { useUser } from "../hooks.tsx";
import { Link } from "../router.tsx";
import { isMac } from "../utils.ts";
import { useStatus } from "../ws.tsx";

interface LayoutProps {
  children: ReactNode;
  sidebar?: ReactNode;
  actions?: ReactNode;
}

function UserMenu() {
  const { data: user } = useUser();
  if (!user) return null;

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  };

  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-xs text-neutral-400 truncate" title={user.email}>
        {user.name || user.email}
      </span>
      <button
        type="button"
        onClick={handleLogout}
        className="text-neutral-500 hover:text-neutral-300 transition-colors p-0.5 shrink-0"
        title="Sign out"
      >
        <LogOut size={14} />
      </button>
    </div>
  );
}

function ActiveRuns() {
  const { data: status } = useStatus();

  if (!status || status.pipelines.length === 0) {
    return <div className="px-4 pb-2 text-[11px] text-neutral-600 shrink-0">No active runs</div>;
  }

  return (
    <div className="px-3 pb-2 shrink-0">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-neutral-500 uppercase tracking-wider mb-1.5">
        <Loader2 size={10} className="animate-spin text-neutral-400" />
        Active
        <span className="font-mono">
          {status.activeRuns}/{status.maxConcurrentRuns}
        </span>
      </div>
      <div className="space-y-0.5">
        {status.pipelines.map((p) =>
          p.runIds.map((runId) => (
            <Link
              key={runId}
              to={`/${p.namespace}/${p.pipelineId}/runs/${runId}`}
              className="flex items-center gap-2 px-2 py-1 text-xs text-neutral-400 hover:text-white hover:bg-white/[0.04] rounded-lg no-underline transition-colors"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse shrink-0" />
              <span className="truncate">
                {p.namespace}/{p.pipelineId}
              </span>
            </Link>
          )),
        )}
      </div>
    </div>
  );
}

export function Layout({ children, sidebar, actions }: LayoutProps) {
  return (
    <div className="flex h-screen">
      <aside className="w-56 bg-neutral-950/40 border-r border-white/[0.06] shrink-0 flex flex-col">
        {/* Brand */}
        <Link
          to="/"
          className="flex items-center gap-1.5 font-bold font-mono tracking-wide text-white no-underline hover:text-neutral-300 transition-colors px-4 h-12 shrink-0"
        >
          <Workflow size={16} />
          Trigger
        </Link>

        {/* Sidebar content */}
        <div className="flex-1 overflow-y-auto px-3 pt-1 pb-3">{sidebar}</div>

        {/* Active runs */}
        <ActiveRuns />

        {/* Bottom bar */}
        <div className="flex items-center justify-between p-3 border-t border-white/[0.06] shrink-0">
          <button
            type="button"
            onClick={() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: isMac, ctrlKey: !isMac }))}
            className="inline-flex items-center gap-1.5 text-[11px] text-neutral-500 hover:text-neutral-300 bg-white/[0.04] border border-white/[0.06] rounded-lg px-2 py-1 transition-colors"
            title={`Search (${isMac ? "\u2318" : "Ctrl+"}K)`}
          >
            <kbd className="text-[11px]">{isMac ? "\u2318" : "Ctrl"}</kbd>
            <span>K</span>
          </button>
          <UserMenu />
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto p-5">
        <div className="max-w-6xl mx-auto animate-fade-in">
          {actions && <div className="flex justify-end mb-4">{actions}</div>}
          {children}
        </div>
      </main>
    </div>
  );
}
