import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "./Button.tsx";

interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

function getPageNumbers(current: number, total: number): (number | "...")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const pages: (number | "...")[] = [1];

  if (current > 3) pages.push("...");

  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);

  for (let i = start; i <= end; i++) pages.push(i);

  if (current < total - 2) pages.push("...");

  pages.push(total);
  return pages;
}

export function Pagination({ page, totalPages, onPageChange }: PaginationProps) {
  if (totalPages <= 1) return null;

  const pages = getPageNumbers(page, totalPages);

  return (
    <div className="flex items-center justify-between text-sm mt-4">
      <span className="text-neutral-500 text-xs">
        Page {page} of {totalPages}
      </span>
      <div className="flex items-center gap-1">
        <Button size="icon" onClick={() => onPageChange(page - 1)} disabled={page <= 1} icon={<ChevronLeft size={14} />} />

        {pages.map((p, i) =>
          p === "..." ? (
            <span key={`ellipsis-${i}`} className="px-2 text-neutral-600 text-xs">
              ...
            </span>
          ) : (
            <button
              type="button"
              key={p}
              onClick={() => onPageChange(p)}
              className={`min-w-7 h-7 rounded-lg text-xs font-medium transition-all duration-150 active:scale-[0.98] ${
                p === page ? "bg-white/[0.12] text-white" : "text-neutral-400 hover:text-white hover:bg-white/[0.06]"
              }`}
            >
              {p}
            </button>
          ),
        )}

        <Button size="icon" onClick={() => onPageChange(page + 1)} disabled={page >= totalPages} icon={<ChevronRight size={14} />} />
      </div>
    </div>
  );
}
