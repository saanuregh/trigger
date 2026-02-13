import { Ban, CheckCircle2, Circle, Loader2, MinusCircle, XCircle } from "lucide-react";

const statusConfig: Record<string, { bg: string; icon: typeof Circle; iconClass?: string }> = {
  pending: { bg: "bg-gray-700 text-gray-300", icon: Circle },
  running: { bg: "bg-blue-900/80 text-blue-300", icon: Loader2, iconClass: "animate-spin" },
  success: { bg: "bg-green-900/80 text-green-300", icon: CheckCircle2 },
  failed: { bg: "bg-red-900/80 text-red-300", icon: XCircle },
  cancelled: { bg: "bg-yellow-900/80 text-yellow-300", icon: Ban },
  skipped: { bg: "bg-gray-800 text-gray-500", icon: MinusCircle },
};

const defaultConfig = { bg: "bg-gray-700 text-gray-300", icon: Circle, iconClass: undefined };

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
  pending: { color: "text-gray-600", icon: Circle },
  running: { color: "text-blue-400", icon: Loader2, iconClass: "animate-spin" },
  success: { color: "text-green-400", icon: CheckCircle2 },
  failed: { color: "text-red-400", icon: XCircle },
  cancelled: { color: "text-yellow-400", icon: Ban },
  skipped: { color: "text-gray-600", icon: MinusCircle },
};

const defaultStepConfig = { color: "text-gray-600", icon: Circle, iconClass: undefined };

export function StepIcon({ status, size = 16 }: { status: string; size?: number }) {
  const config = stepIconConfig[status] ?? defaultStepConfig;
  const Icon = config.icon;

  return <Icon size={size} className={`${config.color} ${config.iconClass ?? ""} shrink-0`} />;
}
