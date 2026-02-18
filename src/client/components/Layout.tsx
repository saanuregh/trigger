import { ChevronRight, LogOut, Workflow } from "lucide-react";
import type { ReactNode } from "react";
import { useUser } from "../hooks.tsx";
import { Link } from "../router.tsx";
import { isMac } from "../utils.ts";

interface Breadcrumb {
  label: string;
  href?: string;
}

interface LayoutProps {
  children: ReactNode;
  sidebar?: ReactNode;
  breadcrumbs?: Breadcrumb[];
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
    <div className="flex items-center gap-2 ml-3 pl-3 border-l border-white/[0.06]">
      <span className="text-xs text-neutral-400 max-w-32 truncate" title={user.email}>
        {user.name || user.email}
      </span>
      <button
        type="button"
        onClick={handleLogout}
        className="text-neutral-500 hover:text-neutral-300 transition-colors p-0.5"
        title="Sign out"
      >
        <LogOut size={14} />
      </button>
    </div>
  );
}

export function Layout({ children, sidebar, breadcrumbs, actions }: LayoutProps) {
  return (
    <div className="flex flex-col h-screen">
      <header className="bg-neutral-950/80 backdrop-blur-xl border-b border-white/[0.06] px-4 h-12 flex items-center justify-between shrink-0">
        <nav className="flex items-center gap-1.5 text-sm">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 font-bold font-mono tracking-wide text-white no-underline hover:text-neutral-300 transition-colors px-2.5 py-1"
          >
            <Workflow size={16} className="text-white" />
            Trigger
          </Link>
          {breadcrumbs?.map((crumb, i) => (
            <span key={i} className="inline-flex items-center gap-1.5">
              <ChevronRight size={14} className="text-neutral-700" />
              {crumb.href ? (
                <Link to={crumb.href} className="text-neutral-400 hover:text-white no-underline transition-colors max-w-48 truncate">
                  {crumb.label}
                </Link>
              ) : (
                <span className="text-neutral-200 max-w-48 truncate">{crumb.label}</span>
              )}
            </span>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          {actions}
          <button
            type="button"
            onClick={() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: isMac, ctrlKey: !isMac }))}
            className="hidden sm:inline-flex items-center gap-1.5 text-[11px] text-neutral-500 hover:text-neutral-300 bg-white/[0.04] border border-white/[0.06] rounded-lg px-2 py-1 transition-colors"
            title={`Search (${isMac ? "\u2318" : "Ctrl+"}K)`}
          >
            <kbd className="text-[11px]">{isMac ? "\u2318" : "Ctrl"}</kbd>
            <span>K</span>
          </button>
          <UserMenu />
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {sidebar && <aside className="w-56 bg-neutral-950/40 border-r border-white/[0.06] overflow-y-auto shrink-0 p-3">{sidebar}</aside>}
        <main className="flex-1 overflow-y-auto p-5">
          <div className="max-w-6xl mx-auto animate-fade-in">{children}</div>
        </main>
      </div>
    </div>
  );
}
