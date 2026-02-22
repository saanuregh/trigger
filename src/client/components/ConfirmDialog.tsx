import { AlertTriangle } from "lucide-react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Button } from "./Button.tsx";

// Ref-count open dialogs so we only clear overflow when the last one closes
let openDialogCount = 0;

interface ConfirmDialogProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  variant?: "danger" | "default";
  loading?: boolean;
}

export function ConfirmDialog({
  open,
  onConfirm,
  onCancel,
  title,
  description,
  confirmLabel = "Confirm",
  variant = "default",
  loading,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    openDialogCount++;
    document.body.style.overflow = "hidden";
    const dialog = dialogRef.current;

    // Move focus into the dialog on open
    requestAnimationFrame(() => {
      const first = dialog?.querySelector<HTMLElement>("button:not([disabled]), [href], input:not([disabled])");
      first?.focus();
    });

    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCancel();
        return;
      }
      if (e.key === "Tab" && dialog) {
        const focusable = dialog.querySelectorAll<HTMLElement>(
          "button:not([disabled]), [href], input:not([disabled]), select:not([disabled])",
        );
        if (focusable.length === 0) return;
        const first = focusable[0]!;
        const last = focusable[focusable.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", handler);
    return () => {
      openDialogCount--;
      if (openDialogCount === 0) document.body.style.overflow = "";
      document.removeEventListener("keydown", handler);
    };
  }, [open, onCancel]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center animate-fade-in" onClick={onCancel}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative bg-neutral-900 border border-white/[0.08] rounded-lg p-5 max-w-md w-full mx-4 animate-scale-in shadow-2xl shadow-black/40"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex gap-4">
          {variant === "danger" && (
            <div className="shrink-0 w-10 h-10 rounded-full bg-red-500/15 border border-red-500/15 flex items-center justify-center">
              <AlertTriangle size={20} className="text-red-400" />
            </div>
          )}
          <div className="flex-1">
            <h3 className="text-base font-semibold text-neutral-100 mb-1">{title}</h3>
            {description && <p className="text-sm text-neutral-400 mb-4">{description}</p>}
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <Button onClick={onCancel} disabled={loading}>
            Cancel
          </Button>
          <Button autoFocus variant={variant === "danger" ? "danger" : "primary"} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
