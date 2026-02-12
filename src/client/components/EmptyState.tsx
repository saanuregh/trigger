import type { ReactNode } from "react";

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description?: string;
}

export function EmptyState({ icon, title, description }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="text-gray-600 mb-3">{icon}</div>
      <h3 className="text-sm font-medium text-gray-400 mb-1">{title}</h3>
      {description && <p className="text-xs text-gray-600 max-w-xs">{description}</p>}
    </div>
  );
}
