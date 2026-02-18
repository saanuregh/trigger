import type { HTMLAttributes, ReactNode } from "react";
import { Link } from "../router.tsx";

const base = "bg-neutral-900 border border-neutral-800 rounded-xl shadow-sm shadow-black/20";
const interactive = "hover:border-neutral-600 hover:shadow-lg hover:shadow-black/40 hover:-translate-y-0.5 transition-all duration-200";

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
