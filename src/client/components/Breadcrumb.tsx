import { ChevronRight, Home } from "lucide-react";
import { Link } from "../router.tsx";

export interface BreadcrumbItem {
  label: string;
  to?: string;
}

export function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
  if (items.length === 0) return null;

  return (
    <nav className="flex items-center gap-1 text-xs min-w-0">
      <Link to="/" className="text-neutral-500 hover:text-neutral-300 transition-colors no-underline shrink-0">
        <Home size={14} />
      </Link>
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        return (
          <span key={i} className="flex items-center gap-1 min-w-0">
            <ChevronRight size={12} className="text-neutral-700 shrink-0" />
            {isLast || !item.to ? (
              <span className="text-neutral-200 truncate">{item.label}</span>
            ) : (
              <Link to={item.to} className="text-neutral-500 hover:text-neutral-300 transition-colors no-underline truncate">
                {item.label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
