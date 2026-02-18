import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
type ButtonSize = "sm" | "md" | "icon";

const variantStyles: Record<ButtonVariant, string> = {
  primary: "bg-white hover:bg-neutral-100 text-neutral-900 font-medium shadow-[0_0_20px_rgba(255,255,255,0.15),0_1px_3px_rgba(0,0,0,0.3)]",
  secondary: "bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white border border-neutral-700",
  danger: "bg-red-900/80 hover:bg-red-800 text-red-200",
  ghost: "hover:bg-neutral-800 text-neutral-400 hover:text-white",
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: "text-xs px-3 py-1.5 gap-1.5",
  md: "text-sm px-4 py-2 gap-2",
  icon: "p-1.5",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  loading?: boolean;
}

export function Button({ variant = "secondary", size = "sm", icon, loading, className = "", children, disabled, ...props }: ButtonProps) {
  const isDisabled = disabled || loading;
  const iconEl = loading ? <Loader2 size={14} className="animate-spin" /> : icon;

  return (
    <button
      className={`inline-flex items-center justify-center rounded-md transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950 disabled:opacity-50 disabled:pointer-events-none ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
      disabled={isDisabled}
      {...props}
    >
      {iconEl}
      {children}
    </button>
  );
}
