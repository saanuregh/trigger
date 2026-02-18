export function handleUnauthorized(res: Response): void {
  if (res.status === 401) {
    window.location.href = `/login?return=${encodeURIComponent(window.location.pathname)}&error=session_expired`;
    throw new Error("Session expired");
  }
}

export function formatDuration(start: string, end: string): string {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
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

export function formatDurationMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

/** Sets the favicon to a colored dot. Pass null to reset to default. */
export function setFaviconStatus(status: string | null): void {
  const link =
    document.querySelector<HTMLLinkElement>('link[rel="icon"]') ??
    (() => {
      const el = document.createElement("link");
      el.rel = "icon";
      document.head.appendChild(el);
      return el;
    })();

  if (!status) {
    link.href = "/favicon.ico";
    return;
  }

  const colors: Record<string, string> = {
    running: "#ffffff",
    pending: "#ffffff",
    success: "#22c55e",
    failed: "#ef4444",
    cancelled: "#eab308",
  };

  const color = colors[status] ?? "#6b7280";
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

import { useEffect, useState } from "react";

/** Returns a live-updating duration string for a running timer. */
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

const statusVerbs: Record<string, string> = {
  success: "succeeded",
  cancelled: "cancelled",
};

export function showRunNotification(pipelineName: string, status: string): void {
  if (!("Notification" in window) || Notification.permission !== "granted") return;

  const verb = statusVerbs[status] ?? "failed";
  const n = new Notification(`${pipelineName} ${verb}`, {
    body: `Pipeline run finished with status: ${status}`,
    tag: `run-${pipelineName}`,
  });
  n.onclick = () => {
    window.focus();
    n.close();
  };
}

// --- Namespace accent colors ---

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

export function nsColor(namespace: string): NsColor {
  let hash = 0;
  for (let i = 0; i < namespace.length; i++) {
    hash = ((hash << 5) - hash + namespace.charCodeAt(i)) | 0;
  }
  return NAMESPACE_COLORS[Math.abs(hash) % NAMESPACE_COLORS.length]!;
}
