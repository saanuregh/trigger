export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
}

export function HomeSkeleton() {
  return (
    <div className="flex gap-6">
      <div className="w-80 shrink-0">
        <Skeleton className="h-3 w-24 mb-2" />
        <div className="bg-neutral-900/50 border border-white/[0.06] rounded-lg overflow-hidden">
          {[1, 2, 3].map((i) => (
            <div key={i} className="px-3 py-2 flex items-center gap-3">
              <Skeleton className="h-2 w-2 rounded-full" />
              <Skeleton className="h-3 w-28" />
            </div>
          ))}
        </div>
      </div>
      <div className="flex-1">
        <Skeleton className="h-3 w-28 mb-2" />
        <div className="bg-neutral-900/50 border border-white/[0.06] rounded-lg overflow-hidden">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="px-3 py-2 flex items-center gap-3">
              <Skeleton className="h-2 w-2 rounded-full" />
              <Skeleton className="h-3 w-40" />
              <div className="flex-1" />
              <Skeleton className="h-3 w-16" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function NamespaceSkeleton() {
  return (
    <div>
      <div className="bg-neutral-900/50 border border-white/[0.06] rounded-lg overflow-hidden">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="px-3 py-1.5 flex items-center justify-between border-t border-white/[0.04] first:border-t-0">
            <div className="space-y-1">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-3 w-32" />
            </div>
            <Skeleton className="h-4 w-16 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function PipelineSkeleton() {
  return (
    <div className="space-y-5">
      <div>
        <Skeleton className="h-3 w-24 mb-2" />
        <div className="bg-neutral-900/50 border border-white/[0.06] rounded-lg p-3 space-y-2">
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-7 w-32" />
        </div>
      </div>
      <div>
        <Skeleton className="h-3 w-24 mb-2" />
        <div className="bg-neutral-900/50 border border-white/[0.06] rounded-lg overflow-hidden">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-1.5 border-t border-white/[0.04] first:border-t-0">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-12 rounded-full" />
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-3 w-10" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ConfigSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-4 w-64" />
      <div>
        <Skeleton className="h-3 w-24 mb-2" />
        <div className="bg-neutral-900/50 border border-white/[0.06] rounded-lg overflow-hidden">
          {[1, 2, 3].map((i) => (
            <div key={i} className="px-3 py-1.5 flex items-center gap-3 border-t border-white/[0.04] first:border-t-0">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-3 w-12" />
              <Skeleton className="h-3 w-16" />
            </div>
          ))}
        </div>
      </div>
      <div>
        <Skeleton className="h-3 w-16 mb-2" />
        <div className="space-y-1.5">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-neutral-900/50 border border-white/[0.06] rounded-lg p-3">
              <div className="flex items-center gap-2">
                <Skeleton className="h-4 w-4" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-16 rounded-lg" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function RunSkeleton() {
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="space-y-1">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-3 w-28" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-7 w-16 rounded-lg" />
          <Skeleton className="h-7 w-20 rounded-lg" />
        </div>
      </div>
      <div className="flex gap-4">
        <div className="w-52 shrink-0 space-y-1">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-2 px-2 py-1.5">
              <Skeleton className="h-3.5 w-3.5 rounded-full" />
              <Skeleton className="h-3 w-32" />
            </div>
          ))}
        </div>
        <div className="flex-1 bg-neutral-900/50 border border-white/[0.06] rounded-lg h-48" />
      </div>
    </div>
  );
}
