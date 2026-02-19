import { AlertCircle } from "lucide-react";
import type { ReactNode } from "react";

export function ErrorMessage({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 bg-red-500/[0.08] border border-red-500/15 rounded-lg px-3 py-2 text-sm text-red-300">
      <AlertCircle size={16} className="text-red-400 shrink-0" />
      <div>{children}</div>
    </div>
  );
}
