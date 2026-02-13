import { createRoot } from "react-dom/client";
import { Workflow, LogIn } from "lucide-react";

function LoginPage() {
  const params = new URLSearchParams(location.search);
  const returnUrl = params.get("return") ?? "/";
  const error = params.get("error");

  return (
    <div className="flex items-center justify-center h-screen">
      <div className="text-center space-y-6 max-w-sm">
        <div className="flex items-center justify-center gap-2 text-2xl font-bold">
          <Workflow size={28} className="text-blue-400" />
          Trigger
        </div>
        <p className="text-gray-400 text-sm">Sign in to access pipelines</p>
        {error && (
          <div className="bg-red-950/50 border border-red-900/50 rounded-lg px-4 py-2 text-sm text-red-300">
            {error === "session_expired" ? "Session expired. Please sign in again." : `Authentication error: ${error}`}
          </div>
        )}
        <a
          href={`/auth/login?return=${encodeURIComponent(returnUrl)}`}
          className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white font-medium px-6 py-2.5 rounded-lg transition-colors no-underline"
        >
          <LogIn size={16} />
          Sign in with SSO
        </a>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<LoginPage />);
