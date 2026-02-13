import { createRoot } from "react-dom/client";
import { SWRConfig } from "swr";
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
import { fetcher } from "./swr.tsx";

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
            <Link to="/" className="text-blue-400 hover:text-blue-300 no-underline">
              Go home
            </Link>
          </>
        }
      />
    </Layout>
  );
}

createRoot(document.getElementById("root")!).render(
  <SWRConfig value={{ fetcher }}>
    <ToastProvider>
      <RouterProvider routes={routes} fallback={NotFound} />
    </ToastProvider>
  </SWRConfig>,
);
