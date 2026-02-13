export function handleUnauthorized(res: Response): void {
  if (res.status === 401) {
    window.location.href = `/login?return=${encodeURIComponent(window.location.pathname)}&error=session_expired`;
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
