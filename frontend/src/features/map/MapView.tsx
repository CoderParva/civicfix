import L from 'leaflet'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import 'leaflet.markercluster/dist/MarkerCluster.Default.css'
import { useEffect } from 'react'
import { Marker, Popup, useMap } from 'react-leaflet'
import MarkerClusterGroup from 'react-leaflet-cluster'
import { Link } from 'react-router-dom'

import { StatusBadge } from '@/features/issues/components/StatusBadge'
import type { Category, Issue } from '@/types/api'

import { BaseMap } from './BaseMap'
import { colorForCategory, pinIcon } from './categoryColors'

/** Zoom the map to fit every marker whenever the set of issues changes (and not on every render). */
function FitToIssues({ issues }: { issues: Issue[] }) {
  const map = useMap()
  const key = issues.map((i) => i.id).join(',')
  useEffect(() => {
    if (issues.length === 0) return
    const bounds = L.latLngBounds(issues.map((i) => [i.location.latitude, i.location.longitude] as [number, number]))
    // animate:false -- an animated move keeps running on animation frames after the map is unmounted
    // (Back, then straight to List) and throws "reading '_leaflet_pos'" on the removed map.
    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 15, animate: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is the identity of `issues`
  }, [map, key])
  return null
}

interface MapViewProps {
  issues: Issue[]
  /** All categories, for the legend. Marker colours come from the category id either way. */
  categories: Category[]
  className?: string
}

/**
 * Every given issue as a pin coloured by category. Pins that are close together collapse into a
 * numbered cluster (identical coordinates fan out when clicked). Clicking a pin opens a popup with
 * the title, category, status and a link to the issue's detail page.
 */
export function MapView({ issues, categories, className = 'h-[28rem]' }: MapViewProps) {
  const used = new Set(issues.map((i) => i.category.id))
  const legend = categories.filter((c) => used.has(c.id))
  return (
    <div className="flex flex-col gap-2">
      <BaseMap label="Map of issues" className={className}>
        <FitToIssues issues={issues} />
        {/* animate/chunkedLoading off for the same reason: their timers can outlive the map */}
        <MarkerClusterGroup animate={false} maxClusterRadius={50} showCoverageOnHover={false}>
          {issues.map((issue) => (
            <Marker
              key={issue.id}
              position={[issue.location.latitude, issue.location.longitude]}
              icon={pinIcon(colorForCategory(issue.category.id))}
              title={issue.title}
            >
              <Popup>
                <div className="flex min-w-48 flex-col gap-1.5">
                  {/* React text nodes: user-written titles are escaped, never injected as HTML */}
                  <strong className="text-sm leading-snug">{issue.title}</strong>
                  <span className="flex items-center gap-1.5 text-xs">
                    <span aria-hidden className="inline-block size-2.5 rounded-full" style={{ background: colorForCategory(issue.category.id) }} />
                    {issue.category.name}
                  </span>
                  <StatusBadge status={issue.status} />
                  <Link to={`/issues/${issue.id}`} className="text-sm font-medium text-primary underline-offset-4 hover:underline">
                    View details
                  </Link>
                </div>
              </Popup>
            </Marker>
          ))}
        </MarkerClusterGroup>
      </BaseMap>
      {legend.length > 0 && (
        <ul aria-label="Map legend" className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {legend.map((c) => (
            <li key={c.id} className="flex items-center gap-1.5">
              <span aria-hidden className="inline-block size-2.5 rounded-full" style={{ background: colorForCategory(c.id) }} />
              {c.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default MapView
