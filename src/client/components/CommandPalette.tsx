import { FolderOpen, GitBranch, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useConfigs } from "../hooks.tsx";
import { navigate } from "../router.tsx";

interface PaletteItem {
  id: string;
  label: string;
  description?: string;
  href: string;
  type: "namespace" | "pipeline";
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const { data: configs } = useConfigs();

  // Build flat list of searchable items
  const items = useMemo<PaletteItem[]>(() => {
    if (!configs) return [];
    const result: PaletteItem[] = [];
    for (const ns of configs) {
      if (ns.error) continue;
      result.push({
        id: `ns:${ns.namespace}`,
        label: ns.display_name,
        href: `/${ns.namespace}`,
        type: "namespace",
      });
      for (const p of ns.pipelines) {
        result.push({
          id: `p:${ns.namespace}:${p.id}`,
          label: p.name,
          description: ns.display_name,
          href: `/${ns.namespace}/${p.id}`,
          type: "pipeline",
        });
      }
    }
    return result;
  }, [configs]);

  const filtered = useMemo(() => {
    if (!query) return items;
    const lower = query.toLowerCase();
    return items.filter((item) => item.label.toLowerCase().includes(lower) || item.description?.toLowerCase().includes(lower));
  }, [items, query]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const close = useCallback(() => setOpen(false), []);

  const handleSelect = useCallback(
    (item: PaletteItem) => {
      close();
      navigate(item.href);
    },
    [close],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "Escape":
          close();
          break;
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) => Math.min(prev + 1, filtered.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case "Enter":
          if (filtered[selectedIndex]) handleSelect(filtered[selectedIndex]);
          break;
      }
    },
    [close, filtered, selectedIndex, handleSelect],
  );

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]" onClick={close}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in" />
      <div
        className="relative w-full max-w-lg bg-neutral-900 border border-white/[0.08] rounded-xl shadow-2xl shadow-black/40 animate-scale-in overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06]">
          <Search size={16} className="text-neutral-500 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Search namespaces and pipelines..."
            className="flex-1 bg-transparent text-sm text-neutral-200 placeholder-neutral-500 focus:outline-none"
          />
          <kbd className="text-[10px] text-neutral-500 bg-white/[0.04] px-1.5 py-0.5 rounded border border-white/[0.06]">ESC</kbd>
        </div>

        <div className="max-h-72 overflow-y-auto py-2">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-neutral-500">No results found</div>
          ) : (
            filtered.map((item, i) => {
              const prevType = filtered[i - 1]?.type;
              const showHeader = !query && item.type !== prevType;
              return (
                <div key={item.id}>
                  {showHeader && (
                    <div className="px-4 py-1.5 text-[10px] text-neutral-500 uppercase tracking-wider font-medium mt-1 first:mt-0">
                      {item.type === "namespace" ? "Namespaces" : "Pipelines"}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => handleSelect(item)}
                    onMouseEnter={() => setSelectedIndex(i)}
                    className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-colors ${
                      i === selectedIndex ? "bg-white/[0.06]" : "hover:bg-white/[0.04]"
                    }`}
                  >
                    {item.type === "namespace" ? (
                      <FolderOpen size={14} className="text-neutral-500 shrink-0" />
                    ) : (
                      <GitBranch size={14} className="text-neutral-500 shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-neutral-200 truncate">{item.label}</div>
                      {item.description && <div className="text-xs text-neutral-500 truncate">{item.description}</div>}
                    </div>
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
