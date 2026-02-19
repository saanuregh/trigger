import type { ReactNode } from "react";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
}

export function EmptyState({ icon, title, description }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="w-16 h-16 rounded-full border border-dashed border-white/[0.08] flex items-center justify-center mb-4">
        <div className="text-neutral-500">{icon}</div>
      </div>
      <h3 className="text-sm font-semibold text-neutral-300 mb-1">{title}</h3>
      {description && <p className="text-xs text-neutral-500 max-w-xs">{description}</p>}
    </div>
  );
}
