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
  if (value === null) return <span className="text-blue-400">null</span>;
  if (typeof value === "boolean") return <span className="text-blue-400">{String(value)}</span>;
  if (typeof value === "number") return <span className="text-orange-300">{value}</span>;
  if (typeof value === "string") return <span className="text-green-400">"{value}"</span>;

  const indent = "  ".repeat(depth + 1);
  const closeIndent = "  ".repeat(depth);

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-gray-500">[]</span>;
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
    if (entries.length === 0) return <span className="text-gray-500">{"{}"}</span>;
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

export function LogViewer({ lines }: { lines: LogLine[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  const [search, setSearch] = useState("");

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    setUserScrolledUp(scrollHeight - scrollTop - clientHeight > 50);
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
    const indexed = lines.map((entry, i) => ({ entry, num: i + 1 }));
    if (!search) return indexed;
    const lower = search.toLowerCase();
    return indexed.filter(({ entry }) => JSON.stringify(entry).toLowerCase().includes(lower));
  }, [lines, search]);

  if (lines.length === 0) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-lg">
        <div className="flex flex-col items-center justify-center py-12 text-gray-600">
          <FileText size={32} className="mb-2" />
          <span className="text-sm">No logs yet</span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg">
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-gray-800">
        <span className="text-xs text-gray-500">{lines.length} lines</span>
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter logs..."
            className="w-full bg-gray-800 border border-gray-700 rounded-md pl-8 pr-8 py-1 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/30 transition-colors"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      <div className="relative">
        <div
          ref={containerRef}
          onScroll={handleScroll}
          className="font-mono text-[11px] leading-snug max-h-[60vh] overflow-y-auto divide-y divide-gray-800/50"
        >
          {filteredLines.map(({ entry, num }) => (
            <div
              key={num}
              className={`flex gap-2 px-3 py-1.5 border-l-2 hover:bg-gray-800/30 ${levelColors[entry.level] ?? "border-l-transparent"}`}
            >
              <span className="text-gray-700 select-none w-6 shrink-0 text-right pt-0.5">{num}</span>
              <div className="text-gray-300 min-w-0 flex-1">
                <JsonLine entry={entry} />
              </div>
            </div>
          ))}
        </div>

        {userScrolledUp && (
          <button
            type="button"
            onClick={scrollToBottom}
            className="absolute bottom-3 right-3 bg-gray-800 border border-gray-700 rounded-full p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 transition-colors shadow-lg shadow-black/30"
            title="Scroll to bottom"
          >
            <ArrowDown size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
