import { useSidebar } from "../utils.ts";
import { useConnected } from "../ws.tsx";

export function ConnectionStatus() {
  const connected = useConnected();
  const { collapsed } = useSidebar();

  if (connected) return null;

  if (collapsed) {
    return (
      <div className="px-2 pb-2 flex justify-center" title="Reconnecting to server…">
        <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="px-3 pb-2 flex items-center gap-1.5 text-xs text-yellow-400/80">
      <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse shrink-0" />
      Reconnecting…
    </div>
  );
}
