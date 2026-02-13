import type { HTMLAttributes, ReactNode } from "react";
import { Link } from "../router.tsx";

const base = "bg-gray-900 border border-gray-800 rounded-lg shadow-sm shadow-black/20";
const interactive = "hover:border-gray-600 hover:shadow-md hover:shadow-black/30 transition-all duration-150";

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
