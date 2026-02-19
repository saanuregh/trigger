import { createContext, type ReactNode, useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import { isMac } from "./utils.ts";

// --- Types ---

export interface ShortcutDef {
  key: string;
  meta?: boolean;
  shift?: boolean;
  description: string;
  handler: () => void;
  when?: boolean;
}

interface RegisteredGroup {
  id: string;
  shortcuts: ShortcutDef[];
}

// --- Registry Context ---

interface ShortcutRegistryContextValue {
  register: (id: string, shortcuts: ShortcutDef[]) => void;
  unregister: (id: string) => void;
  getAll: () => RegisteredGroup[];
}

const ShortcutRegistryContext = createContext<ShortcutRegistryContextValue>({
  register: () => {},
  unregister: () => {},
  getAll: () => [],
});

export function ShortcutRegistryProvider({ children }: { children: ReactNode }) {
  const groupsRef = useRef(new Map<string, ShortcutDef[]>());
  const [, setVersion] = useState(0);

  const register = useCallback((id: string, shortcuts: ShortcutDef[]) => {
    groupsRef.current.set(id, shortcuts);
    setVersion((v) => v + 1);
  }, []);

  const unregister = useCallback((id: string) => {
    groupsRef.current.delete(id);
    setVersion((v) => v + 1);
  }, []);

  const getAll = useCallback((): RegisteredGroup[] => {
    return Array.from(groupsRef.current.entries()).map(([id, shortcuts]) => ({ id, shortcuts }));
  }, []);

  return <ShortcutRegistryContext value={{ register, unregister, getAll }}>{children}</ShortcutRegistryContext>;
}

export function useShortcutRegistry() {
  return useContext(ShortcutRegistryContext);
}

// --- Input/Dialog guards ---

function isInputFocused(): boolean {
  const el = document.activeElement;
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
}

function isDialogOpen(): boolean {
  return document.querySelector("[role='dialog']") !== null;
}

// --- useKeyboard hook ---

export function useKeyboard(shortcuts: ShortcutDef[]) {
  const id = useId();
  const { register, unregister } = useShortcutRegistry();
  const shortcutsRef = useRef(shortcuts);
  shortcutsRef.current = shortcuts;

  useEffect(() => {
    register(id, shortcuts);
    return () => unregister(id);
  }, [id, register, unregister, shortcuts]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      for (const s of shortcutsRef.current) {
        if (s.when === false) continue;

        const wantsMeta = s.meta ?? false;
        const wantsShift = s.shift ?? false;

        const metaHeld = isMac ? e.metaKey : e.ctrlKey;
        if (wantsMeta !== metaHeld) continue;
        if (e.altKey) continue;

        // Only enforce shift check for modifier combos (Cmd+Enter vs Shift+Cmd+Enter).
        // For plain keys, e.key already differentiates (Shift+/ gives "?", not "/").
        if (wantsShift && !e.shiftKey) continue;
        if (!wantsShift && wantsMeta && e.shiftKey) continue;

        if (e.key !== s.key) continue;

        // Single-key shortcuts: skip when input focused or dialog open
        if (!wantsMeta && !wantsShift) {
          if (isInputFocused()) continue;
          if (isDialogOpen()) continue;
        }

        // Modifier shortcuts: skip when dialog open (except Escape)
        if ((wantsMeta || wantsShift) && s.key !== "Escape") {
          if (isDialogOpen()) continue;
        }

        e.preventDefault();
        s.handler();
        return;
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);
}

// --- FocusList component ---

interface FocusListProps<T> {
  items: T[];
  onSelect: (item: T, index: number) => void;
  children: (item: T, focused: boolean, index: number) => ReactNode;
  className?: string;
}

export function FocusList<T>({ items, onSelect, children, className }: FocusListProps<T>) {
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setFocusedIndex(-1);
  }, [items.length]);

  useEffect(() => {
    if (focusedIndex < 0) return;
    const container = containerRef.current;
    if (!container) return;
    const child = container.children[focusedIndex] as HTMLElement | undefined;
    child?.scrollIntoView({ block: "nearest" });
  }, [focusedIndex]);

  useKeyboard([
    {
      key: "j",
      description: "Move down",
      handler: () => setFocusedIndex((i) => Math.min(i + 1, items.length - 1)),
    },
    {
      key: "k",
      description: "Move up",
      handler: () => setFocusedIndex((i) => Math.max(i <= 0 ? 0 : i - 1, 0)),
    },
    {
      key: "Enter",
      description: "Select",
      handler: () => {
        if (focusedIndex >= 0 && focusedIndex < items.length) {
          onSelect(items[focusedIndex]!, focusedIndex);
        }
      },
      when: focusedIndex >= 0,
    },
  ]);

  return (
    <div ref={containerRef} className={className}>
      {items.map((item, i) => children(item, i === focusedIndex, i))}
    </div>
  );
}

// --- Focus ring style helper ---

export const focusRingClass = (focused: boolean) => (focused ? "ring-1 ring-white/20 bg-white/[0.06]" : "");

// --- Display helpers for ? dialog ---

export function formatKey(shortcut: ShortcutDef): string {
  const parts: string[] = [];
  if (shortcut.shift) parts.push(isMac ? "\u21E7" : "Shift");
  if (shortcut.meta) parts.push(isMac ? "\u2318" : "Ctrl");

  const keyMap: Record<string, string> = {
    Enter: isMac ? "\u23CE" : "Enter",
    Backspace: isMac ? "\u232B" : "Backspace",
    "/": "/",
    "?": "?",
  };

  parts.push(keyMap[shortcut.key] ?? shortcut.key.toUpperCase());
  return parts.join(isMac ? " " : "+");
}
