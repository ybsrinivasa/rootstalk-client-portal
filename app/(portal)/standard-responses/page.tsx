'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/** Legacy /standard-responses list — superseded by the four-screen
 * QA hub at /qa/* (commit pending). The detail editor at
 * /standard-responses/[srId] is unchanged; only this list page
 * redirects so old bookmarks land on the new hub. */
export default function LegacyStandardResponsesRedirect() {
  const router = useRouter()
  useEffect(() => { router.replace('/qa/standard-responses') }, [router])
  return (
    <div className="text-center py-12 text-slate-400 text-sm">
      Redirecting to <span className="text-green-700">Q&amp;A · Standard Responses</span>…
    </div>
  )
}
