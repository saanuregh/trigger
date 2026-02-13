import type { AnchorHTMLAttributes, HTMLAttributes } from "react";

const base = "bg-gray-900 border border-gray-800 rounded-lg shadow-sm shadow-black/20";
const interactive = "hover:border-gray-600 hover:shadow-md hover:shadow-black/30 transition-all duration-150";

export function Card({ className = "", children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`${base} ${className}`} {...props}>
      {children}
    </div>
  );
}

export function CardLink({ className = "", children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a className={`${base} ${interactive} no-underline block ${className}`} {...props}>
      {children}
    </a>
  );
}
