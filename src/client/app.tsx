import { Component, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { CommandPalette } from "./components/CommandPalette.tsx";
import { EmptyState } from "./components/EmptyState.tsx";
import { Layout } from "./components/Layout.tsx";
import { ToastProvider } from "./components/Toast.tsx";
import { ConfigPage } from "./config.tsx";
import { HomePage } from "./home.tsx";
import { LoginPage } from "./login.tsx";
import { NamespacePage } from "./namespace.tsx";
import { PipelinePage } from "./pipeline.tsx";
import { Link, RouterProvider } from "./router.tsx";
import { RunPage } from "./run.tsx";
import { WebSocketProvider } from "./ws.tsx";

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

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <ToastProvider>
      <WebSocketProvider>
        <RouterProvider routes={routes} fallback={NotFound} />
        <CommandPalette />
      </WebSocketProvider>
    </ToastProvider>
  </ErrorBoundary>,
);
