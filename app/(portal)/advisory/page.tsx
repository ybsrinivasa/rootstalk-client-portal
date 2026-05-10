'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/** Legacy /advisory list — superseded by the four-screen CCA hub
 * (commit fdbc0a0 + this batch). Kept as a redirect so old bookmarks
 * land somewhere sensible instead of 404. */
export default function LegacyAdvisoryRedirect() {
  const router = useRouter()
  useEffect(() => { router.replace('/cca/packages') }, [router])
  return (
    <div className="text-center py-12 text-slate-400 text-sm">
      Redirecting to <span className="text-green-700">CCA · Packages</span>…
    </div>
  )
}
