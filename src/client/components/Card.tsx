import type { HTMLAttributes, ReactNode } from "react";
import { Link } from "../router.tsx";

const base = "bg-neutral-900/50 border border-white/[0.06] rounded-xl";
const interactive = "transition-colors hover:border-white/[0.1]";

export function Card({ className = "", children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`${base} ${className}`} {...props}>
      {children}
    </div>
  );
}

interface CardLinkProps {
  to: string;
  className?: string;
  children: ReactNode;
}

export function CardLink({ to, className = "", children }: CardLinkProps) {
  return (
    <Link to={to} className={`${base} ${interactive} no-underline block ${className}`}>
      {children}
    </Link>
  );
}
