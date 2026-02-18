import { LogIn, Workflow } from "lucide-react";

export function LoginPage() {
  const params = new URLSearchParams(location.search);
  const returnUrl = params.get("return") ?? "/";
  const error = params.get("error");

  return (
    <div className="flex items-center justify-center h-screen relative">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(255,255,255,0.04)_0%,_transparent_70%)]" />
      <div className="relative text-center space-y-6 max-w-sm bg-neutral-900/60 border border-neutral-700/50 rounded-xl p-8 backdrop-blur-xl depth-elevated">
        <div className="flex items-center justify-center gap-2.5 text-2xl font-bold">
          <Workflow size={32} className="text-white" />
          Trigger
        </div>
        <p className="text-neutral-400 text-sm">Sign in to access pipelines</p>
        {error && (
          <div className="bg-red-950/50 border border-red-900/50 rounded-lg px-4 py-2 text-sm text-red-300">
            {error === "session_expired" ? "Session expired. Please sign in again." : `Authentication error: ${error}`}
          </div>
        )}
        <a
          href={`/auth/login?return=${encodeURIComponent(returnUrl)}`}
          className="inline-flex items-center gap-2 bg-white hover:bg-neutral-100 text-neutral-900 font-medium px-6 py-2.5 rounded-lg transition-all duration-200 no-underline shadow-[0_0_16px_rgba(255,255,255,0.12),0_2px_4px_rgba(0,0,0,0.2)] hover:shadow-[0_0_20px_rgba(255,255,255,0.18),0_4px_8px_rgba(0,0,0,0.3)]"
        >
          <LogIn size={16} />
          Sign in with SSO
        </a>
      </div>
    </div>
  );
}
