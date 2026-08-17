/**
 * Skeleton aligné sur PublicationFiche réelle : même wrapper (flat
 * bg-background, DA v3), mêmes proportions header et sections.
 * Évite le flash de layout pendant la navigation.
 */
export default function PublicationLoading() {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-[1400px] px-6 py-8">
        {/* Header */}
        <div>
          <div className="max-w-6xl mx-auto px-6 sm:px-8 pt-6 pb-8">
            {/* Breadcrumb */}
            <div className="flex items-center gap-1.5 mb-3">
              <div className="h-2.5 w-16 bg-gray-200/60 rounded animate-pulse" />
              <div className="h-2.5 w-1 bg-gray-200/40 rounded animate-pulse" />
              <div className="h-2.5 w-20 bg-gray-200/60 rounded animate-pulse" />
            </div>
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-2.5 w-28 bg-gray-200/50 rounded animate-pulse" />
                <div className="h-10 sm:h-12 w-3/4 max-w-[420px] bg-gray-200/70 rounded-xl animate-pulse" />
                <div className="h-3.5 w-48 bg-gray-200/50 rounded animate-pulse" />
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <div className="h-8 w-20 bg-card border border-border rounded-full animate-pulse" />
                <div className="h-8 w-8 bg-muted rounded-lg animate-pulse" />
              </div>
            </div>
          </div>
        </div>

        <div className="pt-6 md:pt-8 pb-12 px-4 sm:px-6 md:px-8">
          <div className="max-w-6xl mx-auto">
            {/* ProductionChain card placeholder */}
            <div className="p-4 rounded-2xl bg-card border border-border ">
              <div className="flex gap-2 overflow-hidden">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div
                    key={i}
                    className="flex-1 min-w-0 h-[88px] bg-muted/70 rounded-xl animate-pulse"
                    style={{ animationDelay: `${i * 60}ms` }}
                  />
                ))}
              </div>
            </div>

            <div className="mt-8 xl:grid xl:grid-cols-[minmax(0,1fr)_320px] xl:gap-8">
              {/* Colonne workflow */}
              <div className="space-y-10 min-w-0">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="space-y-3">
                    <div className="flex items-center gap-2.5">
                      <div className="h-8 w-8 rounded-lg bg-gray-200/60 animate-pulse" />
                      <div className="h-4 w-32 bg-gray-200/60 rounded animate-pulse" />
                    </div>
                    <div className="space-y-2 pl-10">
                      <div className="h-3 w-full max-w-md bg-muted/80 rounded animate-pulse" />
                      <div className="h-3 w-3/4 max-w-sm bg-muted/80 rounded animate-pulse" />
                    </div>
                  </div>
                ))}
              </div>
              {/* Sidebar (xl+) */}
              <div className="hidden xl:block space-y-4">
                <div className="h-32 rounded-2xl bg-card border border-border animate-pulse" />
                <div className="h-40 rounded-2xl bg-card border border-border animate-pulse" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
