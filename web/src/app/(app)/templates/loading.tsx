export default function TemplatesLoading() {
  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="h-7 w-36 bg-gray-200 rounded-lg animate-pulse" />
          <div className="h-4 w-20 bg-gray-100 rounded mt-2 animate-pulse" />
        </div>
        <div className="h-9 w-40 bg-gray-200 rounded-lg animate-pulse" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="bg-white border border-gray-100 rounded-xl overflow-hidden">
            <div className="h-36 bg-gray-100 animate-pulse" />
            <div className="p-4 space-y-2">
              <div className="h-5 w-3/4 bg-gray-200 rounded animate-pulse" />
              <div className="h-3.5 w-1/2 bg-gray-100 rounded animate-pulse" />
              <div className="flex gap-1 mt-2">
                <div className="h-5 w-16 bg-gray-100 rounded-full animate-pulse" />
                <div className="h-5 w-12 bg-gray-100 rounded-full animate-pulse" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
