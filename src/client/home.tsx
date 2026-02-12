import { useState } from "react";
import { FolderOpen, RefreshCw, AlertTriangle } from "lucide-react";
import { Layout } from "./components/Layout.tsx";
import { Button } from "./components/Button.tsx";
import { Card, CardLink } from "./components/Card.tsx";
import { HomeSkeleton } from "./components/Skeleton.tsx";
import { EmptyState } from "./components/EmptyState.tsx";
import { useToast } from "./components/Toast.tsx";
import { useConfigs, renderPage } from "./swr.tsx";

function HomePage() {
  const { data: configs, mutate } = useConfigs();
  const [refreshing, setRefreshing] = useState(false);
  const { toast } = useToast();

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await fetch("/api/config/refresh", { method: "POST" });
      await mutate();
      toast("Configs refreshed", "success");
    } catch (err) {
      console.error("Failed to refresh configs:", err);
      toast("Failed to refresh configs", "error");
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <Layout
      actions={
        <Button
          onClick={handleRefresh}
          loading={refreshing}
          icon={<RefreshCw size={14} />}
        >
          Refresh configs
        </Button>
      }
    >
      {!configs ? (
        <HomeSkeleton />
      ) : configs.length === 0 ? (
        <EmptyState
          icon={<FolderOpen size={40} />}
          title="No namespaces configured"
          description="Add TRIGGER_{NS}_CONFIG environment variables to get started."
        />
      ) : (
        <div>
          <h1 className="text-lg font-semibold mb-4">Namespaces</h1>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {configs.map((ns) =>
              ns.error ? (
                <Card key={ns.namespace} className="p-4 opacity-50">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-red-900/30 flex items-center justify-center shrink-0">
                      <AlertTriangle size={18} className="text-red-400" />
                    </div>
                    <div className="min-w-0">
                      <h2 className="text-sm font-semibold text-gray-400">
                        {ns.display_name}
                      </h2>
                      <p className="text-xs text-red-400/80 truncate" title={ns.error}>
                        Config failed to load
                      </p>
                    </div>
                  </div>
                </Card>
              ) : (
                <CardLink
                  key={ns.namespace}
                  href={`/${ns.namespace}`}
                  className="p-4"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-blue-900/30 flex items-center justify-center shrink-0">
                      <FolderOpen size={18} className="text-blue-400" />
                    </div>
                    <div>
                      <h2 className="text-sm font-semibold text-gray-200">
                        {ns.display_name}
                      </h2>
                      <p className="text-xs text-gray-500">
                        {ns.pipelines.length} pipeline{ns.pipelines.length !== 1 ? "s" : ""}
                      </p>
                    </div>
                  </div>
                </CardLink>
              )
            )}
          </div>
        </div>
      )}
    </Layout>
  );
}

renderPage(HomePage);
