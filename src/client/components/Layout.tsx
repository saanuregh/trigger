import { ChevronRight, LogOut, Workflow } from "lucide-react";
import type { ReactNode } from "react";
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
    <div className="flex items-center gap-2 ml-3 pl-3 border-l border-gray-700">
      <span className="text-xs text-gray-400 max-w-32 truncate" title={user.email}>
        {user.name || user.email}
      </span>
      <button type="button" onClick={handleLogout} className="text-gray-500 hover:text-gray-300 transition-colors p-0.5" title="Sign out">
        <LogOut size={14} />
      </button>
    </div>
  );
}

export function Layout({ children, sidebar, breadcrumbs, actions }: LayoutProps) {
  return (
    <div className="flex flex-col h-screen">
      <header className="bg-gray-900 border-b border-gray-800 px-4 h-11 flex items-center justify-between shrink-0 shadow-md shadow-black/10">
        <nav className="flex items-center gap-1.5 text-sm">
          <a
            href="/"
            className="inline-flex items-center gap-1.5 font-bold tracking-wide text-white no-underline hover:text-blue-400 transition-colors"
          >
            <Workflow size={16} className="text-blue-400" />
            Trigger
          </a>
          {breadcrumbs?.map((crumb, i) => (
            <span key={i} className="inline-flex items-center gap-1.5">
              <ChevronRight size={14} className="text-gray-600" />
              {crumb.href ? (
                <a href={crumb.href} className="text-gray-400 hover:text-white no-underline transition-colors max-w-48 truncate">
                  {crumb.label}
                </a>
              ) : (
                <span className="text-gray-200 max-w-48 truncate">{crumb.label}</span>
              )}
            </span>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          {actions}
          <UserMenu />
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {sidebar && <aside className="w-56 bg-gray-900/50 border-r border-gray-800 overflow-y-auto shrink-0 p-3">{sidebar}</aside>}
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
