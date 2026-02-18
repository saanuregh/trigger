import { Ban, CheckCircle2, Circle, Loader2, MinusCircle, XCircle } from "lucide-react";

const statusConfig: Record<string, { bg: string; icon: typeof Circle; iconClass?: string }> = {
  pending: { bg: "bg-neutral-700 text-neutral-300", icon: Circle },
  running: { bg: "bg-neutral-700 text-neutral-200 shadow-[0_0_12px_rgba(255,255,255,0.15)]", icon: Loader2, iconClass: "animate-spin" },
  success: { bg: "bg-green-900/80 text-green-300 shadow-[0_0_12px_rgba(74,222,128,0.25)]", icon: CheckCircle2 },
  failed: { bg: "bg-red-900/80 text-red-300 shadow-[0_0_12px_rgba(248,113,113,0.25)]", icon: XCircle },
  cancelled: { bg: "bg-yellow-900/80 text-yellow-300 shadow-[0_0_12px_rgba(250,204,21,0.2)]", icon: Ban },
  skipped: { bg: "bg-neutral-800 text-neutral-500", icon: MinusCircle },
};

const defaultConfig = { bg: "bg-neutral-700 text-neutral-300", icon: Circle, iconClass: undefined };

export function StatusBadge({ status }: { status: string }) {
  const config = statusConfig[status] ?? defaultConfig;
  const Icon = config.icon;

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${config.bg}`}>
      <Icon size={12} className={config.iconClass} />
      {status}
    </span>
  );
}

const stepIconConfig: Record<string, { color: string; icon: typeof Circle; iconClass?: string }> = {
  pending: { color: "text-neutral-600", icon: Circle },
  running: { color: "text-white", icon: Loader2, iconClass: "animate-spin" },
  success: { color: "text-green-400", icon: CheckCircle2 },
  failed: { color: "text-red-400", icon: XCircle },
  cancelled: { color: "text-yellow-400", icon: Ban },
  skipped: { color: "text-neutral-600", icon: MinusCircle },
};

const defaultStepConfig = { color: "text-neutral-600", icon: Circle, iconClass: undefined };

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
