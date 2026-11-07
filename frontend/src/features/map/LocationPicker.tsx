import { useEffect } from 'react'
import { Marker, useMap, useMapEvents } from 'react-leaflet'

import { BaseMap } from './BaseMap'
import { colorForCategory, pinIcon } from './categoryColors'
import { DEFAULT_CENTER, DEFAULT_ZOOM, PICKED_ZOOM } from './tiles'

export interface PickedPoint {
  latitude: number
  longitude: number
}

function ClickToPick({ onPick }: { onPick: (point: PickedPoint) => void }) {
  useMapEvents({
    click(event) {
      onPick({ latitude: event.latlng.lat, longitude: event.latlng.lng })
    },
  })
  return null
}

/** Keep the point in view when it is set from outside the map (typed coordinates, GPS). */
function KeepInView({ point }: { point: PickedPoint | null }) {
  const map = useMap()
  useEffect(() => {
    if (!point) return
    const latlng: [number, number] = [point.latitude, point.longitude]
    if (!map.getBounds().contains(latlng)) map.setView(latlng, Math.max(map.getZoom(), PICKED_ZOOM))
  }, [map, point])
  return null
}

interface LocationPickerProps {
  /** The current point, or null when the coordinate fields are empty/invalid. */
  value: PickedPoint | null
  onPick: (point: PickedPoint) => void
}

/** Click anywhere on the map to drop the marker there and report its coordinates. */
export function LocationPicker({ value, onPick }: LocationPickerProps) {
  return (
    <BaseMap
      label="Map: click to set the issue location"
      center={value ? [value.latitude, value.longitude] : DEFAULT_CENTER}
      zoom={value ? PICKED_ZOOM : DEFAULT_ZOOM}
      className="h-72"
    >
      <ClickToPick onPick={onPick} />
      <KeepInView point={value} />
      {value && <Marker position={[value.latitude, value.longitude]} icon={pinIcon(colorForCategory(4))} />}
    </BaseMap>
  )
}

export default LocationPicker
