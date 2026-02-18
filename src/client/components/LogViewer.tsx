import { ArrowDown, FileText, Search, X } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LogLine } from "../../types.ts";

const levelColors: Record<string, string> = {
  error: "border-l-red-500 bg-red-950/20",
  warn: "border-l-yellow-500 bg-yellow-950/20",
  info: "border-l-transparent",
  debug: "border-l-transparent opacity-60",
};

function JsonValue({ value, depth = 0 }: { value: unknown; depth?: number }): ReactNode {
  if (value === null) return <span className="text-neutral-400">null</span>;
  if (typeof value === "boolean") return <span className="text-neutral-400">{String(value)}</span>;
  if (typeof value === "number") return <span className="text-orange-300">{value}</span>;
  if (typeof value === "string") return <span className="text-green-400">"{value}"</span>;

  const indent = "  ".repeat(depth + 1);
  const closeIndent = "  ".repeat(depth);

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-neutral-500">[]</span>;
    return (
      <>
        {"[\n"}
        {value.map((item, i) => (
          <span key={i}>
            {indent}
            <JsonValue value={item} depth={depth + 1} />
            {i < value.length - 1 ? ",\n" : "\n"}
          </span>
        ))}
        {closeIndent}
        {"]"}
      </>
    );
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return <span className="text-neutral-500">{"{}"}</span>;
    return (
      <>
        {"{\n"}
        {entries.map(([k, v], i) => (
          <span key={k}>
            {indent}
            <span className="text-purple-400">"{k}"</span>: <JsonValue value={v} depth={depth + 1} />
            {i < entries.length - 1 ? ",\n" : "\n"}
          </span>
        ))}
        {closeIndent}
        {"}"}
      </>
    );
  }

  return <span>{String(value)}</span>;
}

function JsonLine({ entry }: { entry: LogLine }) {
  return (
    <pre className="whitespace-pre-wrap break-all">
      <JsonValue value={entry} />
    </pre>
  );
}

interface LogViewerProps {
  lines: LogLine[];
  stepFilter?: string | null;
  fullHeight?: boolean;
}

export function LogViewer({ lines, stepFilter, fullHeight }: LogViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  const [hasScrolled, setHasScrolled] = useState(false);
  const [search, setSearch] = useState("");

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    setUserScrolledUp(scrollHeight - scrollTop - clientHeight > 50);
    setHasScrolled(scrollTop > 0);
  }, []);

  useEffect(() => {
    if (!userScrolledUp && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [lines.length, userScrolledUp]);

  const scrollToBottom = useCallback(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
      setUserScrolledUp(false);
    }
  }, []);

  const filteredLines = useMemo(() => {
    let filtered = lines;
    if (stepFilter) filtered = filtered.filter((entry) => entry.stepId === stepFilter);
    const indexed = filtered.map((entry, i) => ({ entry, num: i + 1 }));
    if (!search) return indexed;
    const lower = search.toLowerCase();
    return indexed.filter(({ entry }) => JSON.stringify(entry).toLowerCase().includes(lower));
  }, [lines, search, stepFilter]);

  if (lines.length === 0) {
    return (
      <div className={`bg-neutral-900 border border-neutral-700/50 rounded-xl card-surface ${fullHeight ? "flex-1" : ""}`}>
        <div className="flex flex-col items-center justify-center py-12 text-neutral-600">
          <FileText size={32} className="mb-2" />
          <span className="text-sm">No logs yet</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-neutral-900 border border-neutral-700/50 rounded-xl card-surface ${fullHeight ? "flex flex-col h-full" : ""}`}>
      <div className="flex items-center justify-between gap-3 px-4 py-2 border-b border-neutral-800 shrink-0">
        <span className="text-xs text-neutral-500 font-mono tabular-nums shrink-0">
          {stepFilter ? `${filteredLines.length} / ${lines.length}` : lines.length} lines
        </span>
        <div className="flex items-center gap-2 flex-1 justify-end">
          {search && (
            <span className="text-[10px] text-neutral-500 shrink-0 font-mono tabular-nums">
              {filteredLines.length} match{filteredLines.length !== 1 ? "es" : ""}
            </span>
          )}
          <div className="relative max-w-xs w-full">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter logs..."
              className="w-full bg-neutral-800 border border-neutral-700 rounded-md pl-8 pr-8 py-1 text-xs text-neutral-300 placeholder-neutral-600 focus:outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500/30 transition-colors"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-300"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className={`relative ${fullHeight ? "flex-1 min-h-0" : ""}`}>
        <div
          ref={containerRef}
          onScroll={handleScroll}
          className={`font-mono text-[11px] leading-snug overflow-y-auto divide-y divide-neutral-800/50 ${fullHeight ? "h-full" : "max-h-[60vh]"} ${hasScrolled ? "log-fade-top" : ""}`}
        >
          {filteredLines.map(({ entry, num }) => (
            <div
              key={num}
              className={`flex gap-2 px-3 py-1.5 border-l-2 hover:bg-neutral-800/30 ${levelColors[entry.level] ?? "border-l-transparent"}`}
            >
              <span className="text-neutral-700 select-none shrink-0 text-right pt-0.5 tabular-nums">
                {new Date(entry.time).toLocaleTimeString("en", { hour12: false })}
              </span>
              <div className="text-neutral-300 min-w-0 flex-1">
                <JsonLine entry={entry} />
              </div>
            </div>
          ))}
        </div>

        {userScrolledUp && (
          <button
            type="button"
            onClick={scrollToBottom}
            className="absolute bottom-3 right-3 bg-neutral-800 border border-neutral-700 rounded-full p-1.5 text-neutral-400 hover:text-white hover:bg-neutral-700 transition-colors shadow-lg shadow-black/30"
            title="Scroll to bottom"
          >
            <ArrowDown size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
