import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { RunStatus } from "../types.ts";

export const isMac = (() => {
  if ("userAgentData" in navigator && (navigator as any).userAgentData?.platform) {
    return /mac/i.test((navigator as any).userAgentData.platform);
  }
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform);
})();

const originalFavicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]')?.href ?? "";

export function handleUnauthorized(res: Response): boolean {
  if (res.status === 401) {
    window.location.href = `/login?return=${encodeURIComponent(window.location.pathname)}&error=session_expired`;
    return true;
  }
  return false;
}

export function formatDurationMs(ms: number): string {
  const s = Math.floor(Math.max(0, ms) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

export function formatDuration(start: string, end: string): string {
  return formatDurationMs(new Date(end).getTime() - new Date(start).getTime());
}

export function formatTime(iso: string): string {
  return iso.replace("T", " ").slice(0, 19);
}

export function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days <= 7) return `${days}d ago`;
  return formatTime(iso);
}

function getFaviconLink(): HTMLLinkElement {
  const existing = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (existing) return existing;
  const el = document.createElement("link");
  el.rel = "icon";
  document.head.appendChild(el);
  return el;
}

const faviconColors: Record<RunStatus, string> = {
  running: "#ffffff",
  pending: "#ffffff",
  success: "#22c55e",
  failed: "#ef4444",
  cancelled: "#eab308",
};

export function setFaviconStatus(status: RunStatus | null): void {
  const link = getFaviconLink();

  if (!status) {
    link.href = originalFavicon;
    return;
  }

  const color = faviconColors[status] ?? "#6b7280";
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext("2d")!;
  ctx.beginPath();
  ctx.arc(16, 16, 14, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  link.href = canvas.toDataURL("image/png");
}

export function useLiveDuration(startedAt: string | null, active: boolean): string {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!active || !startedAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active, startedAt]);

  if (!startedAt || !active) return "";
  return formatDurationMs(now - new Date(startedAt).getTime());
}

export function requestNotificationPermission(): void {
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }
}

export const statusVerbs: Record<RunStatus, string> = {
  pending: "pending",
  running: "running",
  success: "succeeded",
  failed: "failed",
  cancelled: "cancelled",
};

export function showRunNotification(namespace: string, pipelineName: string, status: RunStatus): void {
  if (!("Notification" in window) || Notification.permission !== "granted") return;

  const verb = statusVerbs[status] ?? "failed";
  const n = new Notification(`${pipelineName} ${verb}`, {
    body: `[${namespace}] Pipeline run finished with status: ${status}`,
    tag: `run-${namespace}-${pipelineName}`,
  });
  n.onclick = () => {
    window.focus();
    n.close();
  };
}

const NAMESPACE_COLORS = [
  { bg: "bg-teal-500/15", border: "border-teal-500/40", dot: "bg-teal-400", text: "text-teal-400" },
  { bg: "bg-amber-500/15", border: "border-amber-500/40", dot: "bg-amber-400", text: "text-amber-400" },
  { bg: "bg-violet-500/15", border: "border-violet-500/40", dot: "bg-violet-400", text: "text-violet-400" },
  { bg: "bg-rose-500/15", border: "border-rose-500/40", dot: "bg-rose-400", text: "text-rose-400" },
  { bg: "bg-sky-500/15", border: "border-sky-500/40", dot: "bg-sky-400", text: "text-sky-400" },
  { bg: "bg-lime-500/15", border: "border-lime-500/40", dot: "bg-lime-400", text: "text-lime-400" },
  { bg: "bg-orange-500/15", border: "border-orange-500/40", dot: "bg-orange-400", text: "text-orange-400" },
  { bg: "bg-pink-500/15", border: "border-pink-500/40", dot: "bg-pink-400", text: "text-pink-400" },
] as const;

export type NsColor = (typeof NAMESPACE_COLORS)[number];

export function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function nsColor(namespace: string): NsColor {
  return NAMESPACE_COLORS[hashString(namespace) % NAMESPACE_COLORS.length]!;
}

// --- localStorage-backed state ---

export function useLocalStorage(key: string, defaultValue: boolean): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored !== null ? stored === "true" : defaultValue;
    } catch {
      return defaultValue;
    }
  });

  const set = useCallback(
    (v: boolean) => {
      setValue(v);
      try {
        localStorage.setItem(key, String(v));
      } catch {
        // ignore
      }
    },
    [key],
  );

  return [value, set];
}

// --- Sidebar context ---

interface SidebarContextValue {
  collapsed: boolean;
  toggle: () => void;
}

export const SidebarContext = createContext<SidebarContextValue>({ collapsed: false, toggle: () => {} });
export const useSidebar = () => useContext(SidebarContext);

export function describeCron(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;
  const [min, hour, dom, mon, dow] = parts;
  if (min === "0" && hour !== "*" && dom === "*" && mon === "*" && dow === "*") return `Daily at ${hour}:00`;
  if (min === "0" && hour !== "*" && dom === "*" && mon === "*" && dow === "1-5") return `Weekdays at ${hour}:00`;
  if (min !== "*" && hour === "*" && dom === "*" && mon === "*" && dow === "*") return `Every hour at :${min!.padStart(2, "0")}`;
  if (dom === "*" && mon === "*" && dow === "*") {
    if (hour?.startsWith("*/")) return `Every ${hour.slice(2)}h`;
    if (min?.startsWith("*/")) return `Every ${min.slice(2)}m`;
    if (hour !== "*") return `Daily at ${hour}:${(min ?? "0").padStart(2, "0")}`;
  }
  return cron;
}
