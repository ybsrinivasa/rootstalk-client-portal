'use client'
import { useEffect, useState, useCallback } from 'react'
import api from '@/lib/api'

// 2026-07-05 (Phase T-3) — Shared translation review widget.
// Mounted on the four SE-authored surfaces:
//   - Package edit modal (Package.description)
//   - Practice element editor (Element.value for TITLE / INSTRUCTIONS / DESCRIPTION)
//   - Standard-response editor (StandardResponse.question_text)
//   - Seed variety editor (SeedVariety.description_points)
//
// UX rules from the user (2026-07-05):
//   - SE edits English, checks the translation in whichever language
//     they can read. Translations are READ-ONLY.
//   - Save on the English side re-triggers server-side translation
//     via Celery; the widget refreshes after a short delay.
//   - "Regenerate" button forces a fresh Claude call even when the
//     source hasn't drifted (useful when the SE wants a second pass).
//
// The widget is self-contained — no props for translations. Parent
// just tells it what (entityType, entityId) to review; it fetches
// and manages its own state.

interface LocaleRow {
  language_code: string
  translated_text: string | null
  translation_status: 'PENDING' | 'APPROVED' | 'STALE' | 'FAILED' | 'MISSING'
  is_stale: boolean
  translated_at: string | null
}

interface TranslationsResponse {
  entity_type: string
  entity_id: string
  source_text: string
  source_hash: string
  locales: LocaleRow[]
}

interface Props {
  entityType: string
  entityId: string
  // Optional refresh cadence — useful when the parent knows the SE
  // just saved and Celery is likely mid-flight. Default 0 (no auto).
  pollMs?: number
}

const LOCALE_NAMES: Record<string, string> = {
  hi: 'हिंदी (Hindi)',
  ta: 'தமிழ் (Tamil)',
  te: 'తెలుగు (Telugu)',
  kn: 'ಕನ್ನಡ (Kannada)',
  ml: 'മലയാളം (Malayalam)',
  mr: 'मराठी (Marathi)',
  gu: 'ગુજરાતી (Gujarati)',
  pa: 'ਪੰਜਾਬੀ (Punjabi)',
  or: 'ଓଡ଼ିଆ (Odia)',
  bn: 'বাংলা (Bengali)',
  as: 'অসমীয়া (Assamese)',
  ur: 'اردو (Urdu)',
}

const STATUS_STYLE: Record<LocaleRow['translation_status'], string> = {
  APPROVED: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  PENDING: 'text-amber-700 bg-amber-50 border-amber-200',
  STALE: 'text-orange-700 bg-orange-50 border-orange-200',
  FAILED: 'text-rose-700 bg-rose-50 border-rose-200',
  MISSING: 'text-slate-500 bg-slate-100 border-slate-200',
}

export default function TranslationReview({ entityType, entityId, pollMs = 0 }: Props) {
  const [data, setData] = useState<TranslationsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [regenerating, setRegenerating] = useState(false)
  const [selectedLocale, setSelectedLocale] = useState<string>('hi')
  const [expanded, setExpanded] = useState<boolean>(false)

  const load = useCallback(async () => {
    if (!entityId) return
    try {
      const { data } = await api.get<TranslationsResponse>(
        `/admin/translations/${entityType}/${entityId}`,
      )
      setData(data)
      setError(null)
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status
      if (status === 404) setError('Source not found or not yet saved.')
      else setError('Could not load translations.')
    } finally {
      setLoading(false)
    }
  }, [entityType, entityId])

  useEffect(() => { load() }, [load])

  // Optional polling — when the parent knows a save just happened
  // and translations are being generated in the background.
  useEffect(() => {
    if (!pollMs || pollMs < 500) return
    const t = setInterval(load, pollMs)
    return () => clearInterval(t)
  }, [pollMs, load])

  const regenerate = async () => {
    if (!entityId || regenerating) return
    setRegenerating(true)
    try {
      await api.post(`/admin/translations/${entityType}/${entityId}/regenerate`)
      // Give Celery + Claude a moment to complete before reloading.
      setTimeout(() => { load(); setRegenerating(false) }, 3500)
    } catch {
      setRegenerating(false)
      alert('Could not queue the translation job. Try again in a moment.')
    }
  }

  if (loading) {
    return (
      <div className="mt-4 p-4 rounded-xl border border-slate-200 bg-slate-50">
        <p className="text-xs text-slate-500">Loading translations…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="mt-4 p-4 rounded-xl border border-slate-200 bg-slate-50">
        <p className="text-xs text-slate-500">{error}</p>
      </div>
    )
  }

  if (!data) return null

  const currentLocale = data.locales.find(l => l.language_code === selectedLocale)
  const anyTranslated = data.locales.some(l => l.translated_text)

  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-white">
      {/* Collapsed summary bar */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-50 rounded-t-xl">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-xs font-semibold text-slate-700 uppercase tracking-wider">Translations</span>
          {!anyTranslated && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">
              Not yet generated
            </span>
          )}
          {anyTranslated && (
            <span className="text-[10px] text-slate-500">
              {data.locales.filter(l => l.translated_text).length}/{data.locales.length} languages
            </span>
          )}
        </div>
        <span className="text-slate-400 text-sm">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-slate-100">
          {/* Locale switcher — one pill per language. Selected pill
              shows in green; empty locales dim to signal "not yet". */}
          <div className="flex flex-wrap gap-1.5 pt-3">
            {data.locales.map(l => (
              <button key={l.language_code}
                onClick={() => setSelectedLocale(l.language_code)}
                className={`text-[11px] px-2.5 py-1 rounded-full font-medium border transition-colors ${
                  selectedLocale === l.language_code
                    ? 'bg-green-700 text-white border-green-700'
                    : l.translated_text
                    ? 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    : 'bg-slate-50 text-slate-400 border-slate-200'
                }`}>
                {l.language_code.toUpperCase()}
                {l.is_stale && <span className="ml-1 text-orange-400">•</span>}
              </button>
            ))}
          </div>

          {/* Selected locale rendering */}
          {currentLocale && (
            <div className="pt-1">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] text-slate-600 font-medium">
                  {LOCALE_NAMES[currentLocale.language_code] || currentLocale.language_code}
                </p>
                <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${
                  STATUS_STYLE[currentLocale.translation_status]
                }`}>
                  {currentLocale.translation_status === 'MISSING' ? 'Not yet translated' : currentLocale.translation_status}
                </span>
              </div>
              {currentLocale.translated_text ? (
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-100 text-sm text-slate-800 whitespace-pre-line leading-relaxed">
                  {currentLocale.translated_text}
                </div>
              ) : (
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-100 text-xs text-slate-400">
                  Not yet translated. Try Regenerate below, or save the English source to trigger auto-translation.
                </div>
              )}
              {currentLocale.is_stale && currentLocale.translated_text && (
                <p className="text-[11px] text-orange-600 mt-1.5">
                  This translation is out of date — the English source has changed since it was generated.
                </p>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-between pt-2 border-t border-slate-100">
            <p className="text-[10px] text-slate-400">
              Translations are read-only. To change them, edit the English text above and save.
            </p>
            <button onClick={regenerate}
              disabled={regenerating}
              className="text-xs px-3 py-1.5 rounded-lg bg-green-100 text-green-700 font-medium hover:bg-green-200 disabled:opacity-50">
              {regenerating ? 'Regenerating…' : 'Regenerate'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
