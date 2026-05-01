'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getToken } from '@/lib/auth'

export default function Root() {
  const router = useRouter()
  useEffect(() => {
    if (getToken()) router.replace('/dashboard')
    else router.replace('/login')
  }, [router])
  return <div className="min-h-screen flex items-center justify-center">
    <div className="w-7 h-7 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
  </div>
}
