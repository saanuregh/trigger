import type { HTMLAttributes } from "react";

const base = "bg-neutral-900/50 border border-white/[0.06] rounded-lg";

export function Card({ className = "", children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`${base} ${className}`} {...props}>
      {children}
    </div>
  );
}
