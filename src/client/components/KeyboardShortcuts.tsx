import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { isMac } from "../utils.ts";

const shortcuts = [
  { keys: isMac ? "⌘ K" : "Ctrl K", description: "Search namespaces & pipelines" },
  { keys: isMac ? "⌘ ⏎" : "Ctrl Enter", description: "Run pipeline" },
  { keys: isMac ? "⇧ ⌘ ⏎" : "Shift Ctrl Enter", description: "Dry run pipeline" },
  { keys: "?", description: "Keyboard shortcuts" },
];

function isInputFocused() {
  const el = document.activeElement;
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
}

export function KeyboardShortcuts() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "?" && !e.metaKey && !e.ctrlKey && !isInputFocused()) {
        e.preventDefault();
        setOpen(true);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setOpen(false)}>
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
          <button type="button" onClick={() => setOpen(false)} className="text-neutral-500 hover:text-neutral-300 transition-colors">
            <X size={14} />
          </button>
        </div>
        <div className="p-4 space-y-3">
          {shortcuts.map((s) => (
            <div key={s.keys} className="flex items-center justify-between gap-4">
              <span className="text-sm text-neutral-400">{s.description}</span>
              <kbd className="text-xs font-mono bg-white/[0.06] border border-white/[0.08] px-2 py-0.5 rounded text-neutral-300 shrink-0">
                {s.keys}
              </kbd>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
