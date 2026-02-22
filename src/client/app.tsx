import { Component, type ErrorInfo, type ReactNode, useState } from "react";
import { createRoot } from "react-dom/client";
import type { RunStatus } from "../types.ts";
import { CommandPalette } from "./components/CommandPalette.tsx";
import { EmptyState } from "./components/EmptyState.tsx";
import { KeyboardShortcuts } from "./components/KeyboardShortcuts.tsx";
import { Layout } from "./components/Layout.tsx";
import { ToastProvider, useToast } from "./components/Toast.tsx";
import { ConfigPage } from "./config.tsx";
import { HomePage } from "./home.tsx";
import { useConfigs } from "./hooks.tsx";
import { ShortcutRegistryProvider, useKeyboard } from "./keyboard.tsx";
import { LoginPage } from "./login.tsx";
import { NamespacePage } from "./namespace.tsx";
import { PipelinePage } from "./pipeline.tsx";
import { Link, navigate, RouterProvider } from "./router.tsx";
import { RunPage } from "./run.tsx";
import { requestNotificationPermission, showRunNotification, statusVerbs } from "./utils.ts";
import { useGlobalEvents, WebSocketProvider } from "./ws.tsx";

const toastVariant: Record<RunStatus, "success" | "error" | "info"> = {
  pending: "info",
  running: "info",
  success: "success",
  failed: "error",
  cancelled: "info",
};

function GlobalNotifications() {
  const { toast } = useToast();
  const { data: configs } = useConfigs();

  useGlobalEvents((event) => {
    if (event.type === "run:started") {
      requestNotificationPermission();
      return;
    }
    if (event.type === "run:completed") {
      const verb = statusVerbs[event.status] ?? "failed";
      const nsLabel = configs?.find((c) => c.namespace === event.namespace)?.display_name ?? event.namespace;
      toast(`[${nsLabel}] ${event.pipelineName} ${verb}`, toastVariant[event.status] ?? "error");
      showRunNotification(nsLabel, event.pipelineName, event.status);
    }
  });

  return null;
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Uncaught render error:", error, info.componentStack);
  }

  override render() {
    if (this.state.error) {
      return (
        <Layout>
          <EmptyState
            title="Something went wrong"
            description={
              <>
                <p className="mb-3 font-mono text-xs text-red-400">{this.state.error.message}</p>
                <button type="button" onClick={() => window.location.reload()} className="text-neutral-300 hover:text-white underline">
                  Reload page
                </button>
              </>
            }
          />
        </Layout>
      );
    }
    return this.props.children;
  }
}

const routes = [
  { pattern: "/", component: HomePage },
  { pattern: "/login", component: LoginPage },
  { pattern: "/:ns/:pipelineId/config", component: ConfigPage },
  { pattern: "/:ns/:pipelineId/runs/:runId", component: RunPage },
  { pattern: "/:ns/:pipelineId", component: PipelinePage },
  { pattern: "/:ns", component: NamespacePage },
];

function NotFound() {
  return (
    <Layout>
      <EmptyState
        title="Page not found"
        description={
          <>
            The page you're looking for doesn't exist.{" "}
            <Link to="/" className="text-neutral-300 hover:text-white no-underline">
              Go home
            </Link>
          </>
        }
      />
    </Layout>
  );
}

function GlobalShortcuts({ onOpenPalette, onOpenHelp }: { onOpenPalette: () => void; onOpenHelp: () => void }) {
  useKeyboard([
    { key: "/", description: "Search", handler: onOpenPalette },
    { key: "?", description: "Keyboard shortcuts", handler: onOpenHelp },
    {
      key: "Backspace",
      description: "Go back",
      handler: () => {
        const path = location.pathname;
        if (path === "/") return;
        const parent = path.replace(/\/[^/]+\/?$/, "") || "/";
        navigate(parent);
      },
    },
  ]);
  return null;
}

function App() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  return (
    <ErrorBoundary>
      <ToastProvider>
        <WebSocketProvider>
          <ShortcutRegistryProvider>
            <GlobalNotifications />
            <GlobalShortcuts onOpenPalette={() => setPaletteOpen(true)} onOpenHelp={() => setHelpOpen(true)} />
            <RouterProvider routes={routes} fallback={NotFound} />
            <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
            <KeyboardShortcuts open={helpOpen} onClose={() => setHelpOpen(false)} />
          </ShortcutRegistryProvider>
        </WebSocketProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
