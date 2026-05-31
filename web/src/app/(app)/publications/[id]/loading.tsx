/**
 * Skeleton aligné sur PublicationFiche réelle : même wrapper (shell radial
 * gris diffu + margins/rounded), mêmes proportions header et sections.
 * Évite le flash de layout pendant la navigation.
 */
export default function PublicationLoading() {
  return (
    <div className="min-h-screen">
      <div
        className="my-11 ml-[60px] mr-[100px] rounded-3xl min-h-[calc(100vh-5.5rem)] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06),0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.10)]"
        style={{
          background: "rgb(212, 212, 216)",
        }}
      >
        {/* Header */}
        <div className="rounded-t-3xl">
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
                <div className="h-8 w-20 bg-white/60 backdrop-blur-[12px] rounded-full animate-pulse" />
                <div className="h-8 w-8 bg-white/60 rounded-lg animate-pulse" />
              </div>
            </div>
          </div>
        </div>

        <div className="pt-6 md:pt-8 pb-12 px-4 sm:px-6 md:px-8">
          <div className="max-w-6xl mx-auto">
            {/* ProductionChain card placeholder */}
            <div className="p-4 rounded-2xl bg-white/55 backdrop-blur-[8px] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)]">
              <div className="flex gap-2 overflow-hidden">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div
                    key={i}
                    className="flex-1 min-w-0 h-[88px] bg-gray-100/70 rounded-xl animate-pulse"
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
                      <div className="h-3 w-full max-w-md bg-gray-100/80 rounded animate-pulse" />
                      <div className="h-3 w-3/4 max-w-sm bg-gray-100/80 rounded animate-pulse" />
                    </div>
                  </div>
                ))}
              </div>
              {/* Sidebar (xl+) */}
              <div className="hidden xl:block space-y-4">
                <div className="h-32 rounded-2xl bg-white/55 backdrop-blur-[8px] animate-pulse" />
                <div className="h-40 rounded-2xl bg-white/55 backdrop-blur-[8px] animate-pulse" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
