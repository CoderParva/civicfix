import { maplibreGL } from '@maplibre/maplibre-gl-leaflet'
import 'leaflet/dist/leaflet.css'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { MapContainer, useMap } from 'react-leaflet'

import { cn } from '@/utils/cn'

import './maplibreWorker' // side effect: point MapLibre at its bundled worker

import { DEFAULT_CENTER, DEFAULT_ZOOM, MAX_ZOOM, MIN_ZOOM, OPENFREEMAP_STYLE_URL, webglAvailable } from './tiles'

/**
 * Draws the OpenFreeMap vector style underneath everything else. The required credit (OpenFreeMap,
 * OpenMapTiles, OpenStreetMap) comes from the style itself and shows in the map's attribution
 * control; adding it again by hand printed it twice.
 */
function OpenFreeMapLayer({ onUnavailable }: { onUnavailable: () => void }) {
  const map = useMap()
  useEffect(() => {
    if (!webglAvailable()) {
      onUnavailable()
      return
    }
    let layer: ReturnType<typeof maplibreGL> | undefined
    try {
      layer = maplibreGL({ style: OPENFREEMAP_STYLE_URL })
      layer.addTo(map)
    } catch {
      onUnavailable()
    }
    return () => {
      layer?.remove()
    }
  }, [map, onUnavailable])
  return null
}

interface BaseMapProps {
  /** Accessible name of the map region. */
  label: string
  center?: [number, number]
  zoom?: number
  className?: string
  scrollWheelZoom?: boolean
  children?: ReactNode
}

/** A Leaflet map with the OpenFreeMap base layer. All map features in the app build on this. */
export function BaseMap({ label, center = DEFAULT_CENTER, zoom = DEFAULT_ZOOM, className, scrollWheelZoom = true, children }: BaseMapProps) {
  const [tilesUnavailable, setTilesUnavailable] = useState(false)
  const markUnavailable = useCallback(() => setTilesUnavailable(true), []) // stable: it is an effect dependency
  return (
    <div role="region" aria-label={label} className={cn('relative overflow-hidden rounded-xl border', className)}>
      <MapContainer
        center={center}
        zoom={zoom}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        scrollWheelZoom={scrollWheelZoom}
        className="size-full min-h-64"
      >
        <OpenFreeMapLayer onUnavailable={markUnavailable} />
        {children}
      </MapContainer>
      {tilesUnavailable && (
        <p role="status" className="absolute bottom-6 left-2 z-[1000] rounded bg-background/90 px-2 py-1 text-xs text-muted-foreground shadow">
          The base map needs WebGL, which is unavailable here. Markers are still shown.
        </p>
      )}
    </div>
  )
}
