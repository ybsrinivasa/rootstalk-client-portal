'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/** Legacy /cha list — superseded by the four-screen CHA hub
 * (commit 36e5c73 + this batch). Kept as a redirect so old
 * bookmarks land somewhere sensible. SP authoring (which the
 * legacy page tabbed alongside PG) is temporarily orphaned —
 * rebuild as a separate hub when the team needs it. */
export default function LegacyChaRedirect() {
  const router = useRouter()
  useEffect(() => { router.replace('/cha/recommendations') }, [router])
  return (
    <div className="text-center py-12 text-slate-400 text-sm">
      Redirecting to <span className="text-green-700">CHA · Recommendations</span>…
    </div>
  )
}
