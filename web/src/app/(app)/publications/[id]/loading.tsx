export default function PublicationLoading() {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header skeleton */}
      <div className="sticky top-0 z-20 bg-white border-b border-gray-100 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3">
          {/* Breadcrumb */}
          <div className="flex items-center gap-2 mb-2">
            <div className="h-3 w-16 bg-gray-100 rounded animate-pulse" />
            <div className="h-3 w-2 bg-gray-100 rounded animate-pulse" />
            <div className="h-3 w-32 bg-gray-100 rounded animate-pulse" />
            <div className="h-3 w-2 bg-gray-100 rounded animate-pulse" />
            <div className="h-3 w-20 bg-gray-100 rounded animate-pulse" />
          </div>

          {/* Titre + bouton */}
          <div className="flex items-start gap-3">
            <div className="flex-1 space-y-1.5">
              <div className="h-6 w-64 bg-gray-200 rounded-lg animate-pulse" />
              <div className="flex items-center gap-2">
                <div className="h-4 w-24 bg-gray-100 rounded animate-pulse" />
                <div className="h-5 w-20 bg-gray-100 rounded-full animate-pulse" />
              </div>
            </div>
            <div className="h-8 w-32 bg-gray-200 rounded-lg animate-pulse" />
          </div>

          {/* Badges + assignations */}
          <div className="flex flex-wrap items-center gap-3 mt-3">
            <div className="h-5 w-16 bg-gray-100 rounded-full animate-pulse" />
            <div className="h-5 w-24 bg-gray-100 rounded-full animate-pulse" />
            <div className="hidden sm:block h-3 w-px bg-gray-200" />
            <div className="h-4 w-36 bg-gray-100 rounded animate-pulse" />
            <div className="h-4 w-28 bg-gray-100 rounded animate-pulse" />
          </div>
        </div>
      </div>

      {/* Corps */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Production chain skeleton */}
        <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
          <div className="h-3 w-32 bg-gray-100 rounded animate-pulse mb-3" />
          <div className="flex gap-2 overflow-hidden">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="flex-shrink-0 h-16 w-36 bg-gray-100 rounded-lg animate-pulse"
              />
            ))}
          </div>
        </div>

        {/* Section skeletons */}
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="bg-white border border-gray-100 rounded-xl p-6 shadow-sm"
          >
            <div className="h-4 w-28 bg-gray-200 rounded animate-pulse mb-3" />
            <div className="space-y-2">
              <div className="h-3 w-full bg-gray-100 rounded animate-pulse" />
              <div className="h-3 w-3/4 bg-gray-100 rounded animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
