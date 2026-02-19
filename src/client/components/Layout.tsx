import { ChevronsLeft, ChevronsRight, Loader2, LogOut, Search, Workflow } from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { useUser } from "../hooks.tsx";
import { Link } from "../router.tsx";
import { isMac, SidebarContext, useLocalStorage, useSidebar } from "../utils.ts";
import { useStatus } from "../ws.tsx";
import { Breadcrumb, type BreadcrumbItem } from "./Breadcrumb.tsx";

interface LayoutProps {
  children: ReactNode;
  sidebar?: ReactNode;
  actions?: ReactNode;
  breadcrumbs?: BreadcrumbItem[];
}

function UserMenu() {
  const { data: user } = useUser();
  const { collapsed } = useSidebar();

  if (!user) return null;

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  };

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={handleLogout}
        className="text-neutral-500 hover:text-neutral-300 transition-colors p-1.5 mx-auto block"
        title={`${user.name || user.email} — Sign out`}
      >
        <LogOut size={14} />
      </button>
    );
  }

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
  const { collapsed } = useSidebar();

  if (!status || status.pipelines.length === 0) {
    if (collapsed) return null;
    return <div className="px-4 pb-2 text-[11px] text-neutral-600 shrink-0">No active runs</div>;
  }

  if (collapsed) {
    const totalRuns = status.pipelines.reduce((sum, p) => sum + p.runIds.length, 0);
    return (
      <div className="px-2 pb-2 shrink-0 group relative flex justify-center">
        <div className="relative">
          <Loader2 size={14} className="animate-spin text-neutral-400" />
          <span className="absolute -top-1 -right-1.5 text-[9px] font-bold text-white bg-neutral-700 rounded-full w-3.5 h-3.5 flex items-center justify-center">
            {totalRuns}
          </span>
        </div>
        <div className="sidebar-tooltip">
          {status.activeRuns}/{status.maxConcurrentRuns} active
        </div>
      </div>
    );
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
                <span className="text-neutral-500">{p.namespace}/</span>
                {p.pipelineId}
              </span>
            </Link>
          )),
        )}
      </div>
    </div>
  );
}

function SidebarToggle() {
  const { collapsed, toggle } = useSidebar();

  return (
    <button
      type="button"
      onClick={toggle}
      className="text-neutral-600 hover:text-neutral-400 transition-colors p-0.5 shrink-0"
      title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
    >
      {collapsed ? <ChevronsRight size={14} /> : <ChevronsLeft size={14} />}
    </button>
  );
}

function SidebarContent({ sidebar }: { sidebar?: ReactNode }) {
  const { collapsed } = useSidebar();

  return (
    <aside
      className={`${collapsed ? "w-14" : "w-56"} sidebar-transition bg-neutral-950/40 border-r border-white/[0.06] shrink-0 flex flex-col`}
    >
      {/* Brand */}
      <div className={`flex items-center ${collapsed ? "justify-center" : "justify-between"} px-3 h-12 shrink-0`}>
        <Link
          to="/"
          className={`flex items-center gap-1.5 font-bold font-mono tracking-wide text-white no-underline hover:text-neutral-300 transition-colors ${collapsed ? "" : "px-1"}`}
        >
          <Workflow size={16} />
          {!collapsed && "Trigger"}
        </Link>
        {!collapsed && <SidebarToggle />}
      </div>

      {/* Nav content */}
      <div className={`flex-1 overflow-y-auto ${collapsed ? "px-1" : "px-3"} pt-1 pb-3`}>{sidebar}</div>

      {/* Active runs */}
      <ActiveRuns />

      {/* Bottom bar */}
      <div
        className={`flex items-center ${collapsed ? "flex-col gap-2 py-3" : "justify-between p-3"} border-t border-white/[0.06] shrink-0`}
      >
        {collapsed ? (
          <>
            <SidebarToggle />
            <button
              type="button"
              onClick={() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: isMac, ctrlKey: !isMac }))}
              className="text-neutral-500 hover:text-neutral-300 transition-colors p-1.5"
              title={`Search (${isMac ? "\u2318" : "Ctrl+"}K)`}
            >
              <Search size={14} />
            </button>
            <UserMenu />
          </>
        ) : (
          <>
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
          </>
        )}
      </div>
    </aside>
  );
}

export function Layout({ children, sidebar, actions, breadcrumbs }: LayoutProps) {
  const [collapsed, setCollapsed] = useLocalStorage("trigger:sidebar-collapsed", false);

  // Auto-collapse on narrow viewports
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const handler = (e: MediaQueryListEvent) => {
      if (e.matches) setCollapsed(true);
    };
    if (mq.matches) setCollapsed(true);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const toggle = () => setCollapsed(!collapsed);

  return (
    <SidebarContext value={{ collapsed, toggle }}>
      <div className="flex h-screen">
        <SidebarContent sidebar={sidebar} />

        <main className="flex-1 overflow-y-auto flex flex-col min-w-0">
          {/* Header bar: breadcrumbs (only when sidebar collapsed) + actions */}
          {((collapsed && breadcrumbs?.length) || actions) && (
            <div className="flex items-center justify-between gap-4 px-5 h-12 border-b border-white/[0.06] shrink-0">
              {collapsed ? <Breadcrumb items={breadcrumbs ?? []} /> : <div />}
              {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-5">
            <div className="max-w-6xl mx-auto animate-fade-in">{children}</div>
          </div>
        </main>
      </div>
    </SidebarContext>
  );
}
