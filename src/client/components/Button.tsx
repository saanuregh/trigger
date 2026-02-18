import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
type ButtonSize = "sm" | "md" | "icon";

const variantStyles: Record<ButtonVariant, string> = {
  primary: "bg-white/[0.12] text-white font-medium border border-white/[0.1] hover:bg-white/[0.18]",
  secondary: "bg-white/[0.06] text-neutral-300 border border-white/[0.08] hover:bg-white/[0.1] hover:text-white",
  danger: "bg-red-500/15 text-red-400 border border-red-500/20 hover:bg-red-500/25",
  ghost: "text-neutral-400 hover:bg-white/[0.06] hover:text-white",
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
      className={`inline-flex items-center justify-center rounded-lg transition-all duration-150 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/[0.2] focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950 disabled:opacity-50 disabled:pointer-events-none ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
      disabled={isDisabled}
      {...props}
    >
      {iconEl}
      {children}
    </button>
  );
}
