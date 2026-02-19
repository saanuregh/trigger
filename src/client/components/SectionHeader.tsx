import type { ReactNode } from "react";

export function SectionHeader({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <h2 className={`text-xs font-medium text-neutral-500 uppercase tracking-wider ${className}`}>{children}</h2>;
}
