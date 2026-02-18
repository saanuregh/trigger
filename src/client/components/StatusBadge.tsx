import { Ban, CheckCircle2, Circle, Loader2, MinusCircle, XCircle } from "lucide-react";

interface IconConfig {
  icon: typeof Circle;
  iconClass?: string;
}

const statusConfig: Record<string, IconConfig & { bg: string }> = {
  pending: { bg: "bg-neutral-500/15 text-neutral-400 border border-neutral-500/15", icon: Circle },
  running: { bg: "bg-white/[0.08] text-neutral-200 border border-white/[0.1]", icon: Loader2, iconClass: "animate-spin" },
  success: { bg: "bg-green-500/15 text-green-400 border border-green-500/15", icon: CheckCircle2 },
  failed: { bg: "bg-red-500/15 text-red-400 border border-red-500/15", icon: XCircle },
  cancelled: { bg: "bg-yellow-500/15 text-yellow-400 border border-yellow-500/15", icon: Ban },
  skipped: { bg: "bg-neutral-500/10 text-neutral-500 border border-neutral-500/10", icon: MinusCircle },
};

const defaultStatusConfig: IconConfig & { bg: string } = {
  bg: "bg-neutral-500/15 text-neutral-400 border border-neutral-500/15",
  icon: Circle,
};

export function StatusBadge({ status }: { status: string }) {
  const config = statusConfig[status] ?? defaultStatusConfig;
  const Icon = config.icon;

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${config.bg}`}>
      <Icon size={12} className={config.iconClass} />
      {status}
    </span>
  );
}

const stepIconConfig: Record<string, IconConfig & { color: string }> = {
  pending: { color: "text-neutral-600", icon: Circle },
  running: { color: "text-white", icon: Loader2, iconClass: "animate-spin" },
  success: { color: "text-green-400", icon: CheckCircle2 },
  failed: { color: "text-red-400", icon: XCircle },
  cancelled: { color: "text-yellow-400", icon: Ban },
  skipped: { color: "text-neutral-600", icon: MinusCircle },
};

const defaultStepConfig: IconConfig & { color: string } = { color: "text-neutral-600", icon: Circle };

export function StepIcon({ status, size = 16 }: { status: string; size?: number }) {
  const config = stepIconConfig[status] ?? defaultStepConfig;
  const Icon = config.icon;

  return <Icon size={size} className={`${config.color} ${config.iconClass ?? ""} shrink-0`} />;
}

const dotColors: Record<string, string> = {
  pending: "bg-neutral-500",
  running: "bg-white animate-pulse",
  success: "bg-green-400",
  failed: "bg-red-400",
  cancelled: "bg-yellow-400",
  skipped: "bg-neutral-600",
};

export function StatusDot({ status }: { status: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-neutral-400">
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColors[status] ?? "bg-neutral-500"}`} />
      {status}
    </span>
  );
}
