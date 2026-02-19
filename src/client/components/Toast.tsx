import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import { createContext, type ReactNode, useCallback, useContext, useState } from "react";

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
  success: { style: "border-green-500/15 bg-neutral-900/95", icon: CheckCircle2, iconColor: "text-green-400" },
  error: { style: "border-red-500/15 bg-neutral-900/95", icon: XCircle, iconColor: "text-red-400" },
  info: { style: "border-white/[0.06] bg-neutral-900/95", icon: Info, iconColor: "text-neutral-400" },
};

let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, removing: true } : t)));
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 200);
  }, []);

  const toast = useCallback(
    (message: string, variant: ToastVariant = "info") => {
      const id = nextId++;
      setToasts((prev) => [...prev, { id, message, variant }]);
      setTimeout(() => dismiss(id), 4000);
    },
    [dismiss],
  );

  return (
    <ToastContext value={{ toast }}>
      {children}
      <output aria-live="polite" className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => {
          const { style, icon: Icon, iconColor } = variantConfig[t.variant];
          return (
            <div
              key={t.id}
              className={`pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-lg border shadow-2xl shadow-black/40 backdrop-blur-md text-sm text-neutral-200 ${style} ${t.removing ? "animate-fade-out" : "animate-slide-up"}`}
            >
              <Icon size={16} className={iconColor} />
              <span className="flex-1">{t.message}</span>
              <button type="button" onClick={() => dismiss(t.id)} className="text-neutral-500 hover:text-neutral-300 transition-colors">
                <X size={14} />
              </button>
            </div>
          );
        })}
      </output>
    </ToastContext>
  );
}
