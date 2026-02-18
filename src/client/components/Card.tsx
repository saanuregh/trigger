import type { HTMLAttributes, ReactNode } from "react";
import { Link } from "../router.tsx";

const base = "bg-neutral-900 border border-neutral-700/50 rounded-xl card-surface";
const interactive = "card-interactive hover:border-neutral-600 hover:-translate-y-0.5";

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
