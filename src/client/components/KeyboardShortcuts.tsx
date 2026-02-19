import { X } from "lucide-react";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { formatKey, useShortcutRegistry } from "../keyboard.tsx";

export function KeyboardShortcuts({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { getAll } = useShortcutRegistry();

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  const seen = new Set<string>();
  const shortcuts: { keys: string; description: string }[] = [];
  for (const group of getAll()) {
    for (const s of group.shortcuts) {
      if (s.when === false) continue;
      const display = formatKey(s);
      const dedupeKey = `${display}:${s.description}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      shortcuts.push({ keys: display, description: s.description });
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        className="relative bg-neutral-900 border border-white/[0.08] rounded-lg max-w-sm w-full mx-4 animate-scale-in shadow-2xl shadow-black/40 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
          <h2 className="text-sm font-semibold text-neutral-200">Keyboard Shortcuts</h2>
          <button type="button" onClick={onClose} className="text-neutral-500 hover:text-neutral-300 transition-colors">
            <X size={14} />
          </button>
        </div>
        <div className="p-4 space-y-3 max-h-96 overflow-y-auto">
          {shortcuts.length === 0 ? (
            <div className="text-sm text-neutral-500">No shortcuts available</div>
          ) : (
            shortcuts.map((s) => (
              <div key={`${s.keys}:${s.description}`} className="flex items-center justify-between gap-4">
                <span className="text-sm text-neutral-400">{s.description}</span>
                <kbd className="text-xs font-mono bg-white/[0.06] border border-white/[0.08] px-2 py-0.5 rounded text-neutral-300 shrink-0">
                  {s.keys}
                </kbd>
              </div>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
