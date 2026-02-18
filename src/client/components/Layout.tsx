import { ChevronRight, Command, LogOut, Workflow } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "../router.tsx";
import { useUser } from "../swr.tsx";

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
    <div className="flex items-center gap-2 ml-3 pl-3 border-l border-neutral-700">
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
      <header className="bg-neutral-900/80 backdrop-blur-md border-b border-neutral-800/50 px-4 h-12 flex items-center justify-between shrink-0 shadow-[0_1px_12px_rgba(0,0,0,0.3)]">
        <nav className="flex items-center gap-1.5 text-sm">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 font-bold font-mono tracking-wide text-white no-underline hover:text-neutral-300 transition-colors bg-neutral-800/50 rounded-lg px-2.5 py-1"
          >
            <Workflow size={16} className="text-white" />
            Trigger
          </Link>
          {breadcrumbs?.map((crumb, i) => (
            <span key={i} className="inline-flex items-center gap-1.5">
              <ChevronRight size={14} className="text-neutral-600" />
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
            onClick={() => dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))}
            className="hidden sm:inline-flex items-center gap-1.5 text-[11px] text-neutral-500 hover:text-neutral-300 bg-neutral-800/50 border border-neutral-700/50 rounded-md px-2 py-1 transition-colors"
            title="Search (⌘K)"
          >
            <Command size={11} />
            <span>K</span>
          </button>
          <UserMenu />
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {sidebar && <aside className="w-56 bg-neutral-900/50 border-r border-neutral-800 overflow-y-auto shrink-0 p-3">{sidebar}</aside>}
        <main className="flex-1 overflow-y-auto p-5">
          <div className="max-w-6xl mx-auto animate-fade-in">{children}</div>
        </main>
      </div>
    </div>
  );
}
