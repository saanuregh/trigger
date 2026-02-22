import { LogIn, Workflow } from "lucide-react";

export function LoginPage() {
  const params = new URLSearchParams(location.search);
  const rawReturn = params.get("return") ?? "/";
  const returnUrl = rawReturn.startsWith("/") && !rawReturn.startsWith("//") ? rawReturn : "/";
  const error = params.get("error");

  return (
    <div className="flex items-center justify-center h-screen relative dot-grid">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(255,255,255,0.04)_0%,_transparent_70%)]" />
      <div className="relative text-center space-y-6 max-w-sm bg-neutral-900/60 border border-white/[0.08] rounded-lg p-8 backdrop-blur-xl shadow-2xl shadow-black/40">
        <div className="flex items-center justify-center gap-2.5 text-2xl font-bold">
          <Workflow size={32} className="text-white" />
          Trigger
        </div>
        <p className="text-neutral-400 text-sm">Sign in to access pipelines</p>
        {error && (
          <div className="bg-red-500/[0.08] border border-red-500/15 rounded-lg px-4 py-2 text-sm text-red-300">
            {{
              session_expired: "Session expired. Please sign in again.",
              missing_params: "Authentication failed — missing parameters.",
              invalid_state: "Authentication failed — invalid state.",
              auth_failed: "Authentication failed. Please try again.",
              access_denied: "Access denied.",
            }[error] ?? "Authentication failed. Please try again."}
          </div>
        )}
        <a
          href={`/auth/login?return=${encodeURIComponent(returnUrl)}`}
          className="inline-flex items-center gap-2 bg-white/[0.12] hover:bg-white/[0.18] text-white font-medium border border-white/[0.1] px-6 py-2.5 rounded-lg transition-all duration-150 active:scale-[0.98] no-underline"
        >
          <LogIn size={16} />
          Sign in with SSO
        </a>
      </div>
    </div>
  );
}
