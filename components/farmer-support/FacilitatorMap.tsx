'use client'
import { useEffect, useRef } from 'react'
import type * as LType from 'leaflet'

// Leaflet map for the Farmer Support 360° view. Plots the farmer
// (red) + every onboarded facilitator at the sub's client (variable
// colour by role) so the RM can judge whether the current alert
// receiver is the right / closest person to call.
//
// Vanilla Leaflet (no react-leaflet) — matches the PWA's RecipientMap
// pattern, keeps the bundle a bit smaller. Loads leaflet dynamically
// inside useEffect so Next's SSR pass doesn't touch `window`.

export type FacRole = 'ALERT_RECEIVER' | 'PROMOTER_PUNDIT' | 'PROMOTER' | 'FACILITATOR'

export interface FacilitatorPin {
  user_id: string
  name: string | null
  phone: string | null
  gps_lat: number | null
  gps_lng: number | null
  distance_km: number | null
  role: FacRole
}

export interface FarmerPin {
  user_id: string
  name: string | null
  phone: string | null
  gps_lat: number
  gps_lng: number
}

const ROLE_COLOUR: Record<FacRole, string> = {
  ALERT_RECEIVER: '#2563EB',    // blue — highlighted, the one being paged
  PROMOTER_PUNDIT: '#7C3AED',   // purple — elevated-status facilitator
  PROMOTER: '#059669',          // teal — plain promoter for this sub
  FACILITATOR: '#64748B',       // slate — other onboarded facilitators
}

const ROLE_LABEL: Record<FacRole, string> = {
  ALERT_RECEIVER: 'Alert receiver',
  PROMOTER_PUNDIT: 'Promoter-Pundit',
  PROMOTER: 'Promoter',
  FACILITATOR: 'Facilitator',
}

export default function FacilitatorMap({
  farmer,
  facilitators,
}: {
  farmer: FarmerPin
  facilitators: FacilitatorPin[]
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<LType.Map | null>(null)

  useEffect(() => {
    let cancelled = false
    async function mount() {
      const L = (await import('leaflet')).default
      // Leaflet's default marker assets depend on bundler-resolved
      // paths that break under Next; we use divIcons exclusively, so
      // no asset-path shim needed.
      if (cancelled || !containerRef.current) return
      if (mapRef.current) return

      const map = L.map(containerRef.current, {
        zoomControl: true,
        attributionControl: true,
      }).setView([farmer.gps_lat, farmer.gps_lng], 13)
      mapRef.current = map

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap contributors',
      }).addTo(map)

      // Farmer pin — red circle, slightly larger, always on top.
      const farmerIcon = L.divIcon({
        html: `<div style="width:22px;height:22px;border-radius:50%;background:#DC2626;border:3px solid white;box-shadow:0 0 0 2px #DC2626,0 2px 4px rgba(0,0,0,0.3);"></div>`,
        className: '',
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      })
      const fMarker = L.marker([farmer.gps_lat, farmer.gps_lng], {
        icon: farmerIcon,
        zIndexOffset: 1000,
      }).addTo(map)
      fMarker.bindTooltip(
        tooltipHtml({
          title: farmer.name || 'Farmer',
          role: 'Farmer',
          phone: farmer.phone,
          distanceKm: null,
          colour: '#DC2626',
        }),
        { direction: 'top', opacity: 0.95, offset: [0, -8] }
      )

      // Facilitator pins.
      const coords: Array<[number, number]> = [[farmer.gps_lat, farmer.gps_lng]]
      facilitators.forEach(p => {
        if (p.gps_lat == null || p.gps_lng == null) return
        const colour = ROLE_COLOUR[p.role]
        const isAR = p.role === 'ALERT_RECEIVER'
        const icon = L.divIcon({
          html: `<div style="width:${isAR ? 20 : 16}px;height:${isAR ? 20 : 16}px;border-radius:50%;background:${colour};border:${isAR ? 3 : 2}px solid white;box-shadow:0 0 0 ${isAR ? 2 : 1}px ${colour},0 1px 3px rgba(0,0,0,0.3);"></div>`,
          className: '',
          iconSize: [isAR ? 20 : 16, isAR ? 20 : 16],
          iconAnchor: [isAR ? 10 : 8, isAR ? 10 : 8],
        })
        const m = L.marker([p.gps_lat, p.gps_lng], {
          icon,
          zIndexOffset: isAR ? 500 : 0,
        }).addTo(map)
        m.bindTooltip(
          tooltipHtml({
            title: p.name || '—',
            role: ROLE_LABEL[p.role],
            phone: p.phone,
            distanceKm: p.distance_km,
            colour,
          }),
          { direction: 'top', opacity: 0.95, offset: [0, -8] }
        )
        coords.push([p.gps_lat, p.gps_lng])
      })

      if (coords.length > 1) {
        map.fitBounds(L.latLngBounds(coords), { padding: [30, 30], maxZoom: 14 })
      }
    }
    void mount()
    return () => {
      cancelled = true
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [farmer.user_id, facilitators.length])

  return (
    <div
      ref={containerRef}
      className="w-full h-72 rounded-lg overflow-hidden border border-slate-200 bg-slate-50"
      style={{ zIndex: 0 }}
    />
  )
}

function tooltipHtml({
  title, role, phone, distanceKm, colour,
}: {
  title: string
  role: string
  phone: string | null
  distanceKm: number | null
  colour: string
}): string {
  const esc = (s: string) => s.replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c] || c)
  const parts: string[] = []
  parts.push(`<div style="font-size:12px;line-height:1.35;min-width:140px;">`)
  parts.push(`<div style="font-weight:700;color:#0F172A;">${esc(title)}</div>`)
  parts.push(`<div style="color:${colour};font-weight:600;font-size:11px;">${esc(role)}</div>`)
  if (phone) parts.push(`<div style="color:#334155;font-size:11px;">${esc(phone)}</div>`)
  if (distanceKm != null) parts.push(`<div style="color:#64748B;font-size:11px;">${distanceKm} km from farmer</div>`)
  parts.push(`</div>`)
  return parts.join('')
}
