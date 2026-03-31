export default function ReportsLoading() {
  return (
    <div className="max-w-5xl mx-auto py-8 px-4 space-y-5">
      {/* Header */}
      <div>
        <div className="h-8 w-20 bg-gray-200 rounded-lg animate-pulse" />
        <div className="h-7 w-48 bg-gray-200 rounded mt-2 animate-pulse" />
        <div className="h-4 w-64 bg-gray-100 rounded mt-1 animate-pulse" />
      </div>

      {/* Debt cards skeleton */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-gray-100 px-5 py-4 h-20 animate-pulse" />
        <div className="rounded-xl bg-gray-100 px-5 py-4 h-20 animate-pulse" />
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 flex gap-0">
        <div className="h-9 w-24 bg-gray-200 rounded-t animate-pulse mx-1" />
        <div className="h-9 w-28 bg-gray-100 rounded-t animate-pulse mx-1" />
      </div>

      {/* Year selector */}
      <div className="flex gap-1.5">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="h-8 w-14 bg-gray-200 rounded-lg animate-pulse" />
        ))}
      </div>

      {/* Table skeleton */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="border-b border-gray-100 bg-gray-50 h-10" />
        {[0, 1, 2, 3, 4].map(i => (
          <div key={i} className="border-b border-gray-100 px-4 py-3 flex gap-4">
            <div className="h-4 w-20 bg-gray-100 rounded animate-pulse" />
            <div className="h-4 flex-1 bg-gray-100 rounded animate-pulse" />
            <div className="h-4 w-16 bg-gray-100 rounded animate-pulse" />
            <div className="h-4 w-16 bg-gray-100 rounded animate-pulse" />
            <div className="h-4 w-24 bg-gray-100 rounded animate-pulse" />
            <div className="h-4 w-16 bg-gray-100 rounded animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  )
}
