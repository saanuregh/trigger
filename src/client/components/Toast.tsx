import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";

type ToastVariant = "success" | "error" | "info";

interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
  removing?: boolean;
}

interface ToastContextValue {
  toast: (message: string, variant?: ToastVariant) => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

const variantConfig: Record<ToastVariant, { style: string; icon: typeof CheckCircle2; iconColor: string }> = {
  success: { style: "border-green-800/50 bg-green-950/90", icon: CheckCircle2, iconColor: "text-green-400" },
  error: { style: "border-red-800/50 bg-red-950/90", icon: XCircle, iconColor: "text-red-400" },
  info: { style: "border-neutral-700 bg-neutral-900/90", icon: Info, iconColor: "text-neutral-400" },
};

let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const toast = useCallback((message: string, variant: ToastVariant = "info") => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, message, variant }]);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, removing: true } : t)));
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 200);
  }, []);

  useEffect(() => {
    if (toasts.length === 0) return;
    const latest = toasts[toasts.length - 1]!;
    if (latest.removing) return;
    const timer = setTimeout(() => dismiss(latest.id), 4000);
    return () => clearTimeout(timer);
  }, [toasts, dismiss]);

  return (
    <ToastContext value={{ toast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => {
          const { style, icon: Icon, iconColor } = variantConfig[t.variant];
          return (
            <div
              key={t.id}
              className={`pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-lg border shadow-[0_4px_12px_rgba(0,0,0,0.4),0_1px_3px_rgba(0,0,0,0.3)] backdrop-blur-md text-sm text-neutral-200 ${style} ${t.removing ? "animate-fade-out" : "animate-slide-up"}`}
            >
              <Icon size={16} className={iconColor} />
              <span className="flex-1">{t.message}</span>
              <button type="button" onClick={() => dismiss(t.id)} className="text-neutral-500 hover:text-neutral-300 transition-colors">
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext>
  );
}
