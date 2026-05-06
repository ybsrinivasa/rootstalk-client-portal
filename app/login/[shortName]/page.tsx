'use client'
import { useParams } from 'next/navigation'
import LoginForm from '../LoginForm'

// Branded login: lands here when the credentials email link embeds
// the short_name (e.g. https://rstalk.eywa.farm/login/khaza).
// LoginForm reads `initialShortName`, fetches the company's branding
// on mount, and skips the company-name step. On 404 (typo / stale
// link) LoginForm falls back to the company-name step with the
// short_name pre-filled and an error message.
//
// Sister file: ../page.tsx (generic flow).
export default function BrandedLoginPage() {
  const params = useParams<{ shortName: string }>()
  const shortName = (params?.shortName || '').toLowerCase()
  return <LoginForm initialShortName={shortName} />
}
