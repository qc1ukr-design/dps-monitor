export default function DocumentsLoading() {
  return (
    <div className="max-w-5xl mx-auto py-10 px-4 space-y-6">
      {/* Header */}
      <div>
        <div className="h-8 w-20 bg-gray-200 rounded-lg animate-pulse" />
        <div className="flex items-center justify-between mt-2">
          <div>
            <div className="h-7 w-48 bg-gray-200 rounded animate-pulse" />
            <div className="h-4 w-64 bg-gray-100 rounded mt-1 animate-pulse" />
          </div>
        </div>
      </div>

      {/* Table skeleton */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="border-b border-gray-100 bg-gray-50 h-10" />
        {[0, 1, 2, 3, 4, 5].map(i => (
          <div key={i} className="border-b border-gray-100 px-4 py-3 flex gap-4">
            <div className="h-4 w-20 bg-gray-100 rounded animate-pulse" />
            <div className="h-4 w-24 bg-gray-100 rounded animate-pulse" />
            <div className="h-4 w-20 bg-gray-100 rounded animate-pulse" />
            <div className="h-4 flex-1 bg-gray-100 rounded animate-pulse" />
            <div className="h-4 w-28 bg-gray-100 rounded animate-pulse" />
            <div className="h-4 w-16 bg-gray-100 rounded animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  )
}
