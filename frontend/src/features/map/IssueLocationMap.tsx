import { Marker } from 'react-leaflet'

import { BaseMap } from './BaseMap'
import { colorForCategory, pinIcon } from './categoryColors'
import { PICKED_ZOOM } from './tiles'

/** A small map centred on one issue's exact location. */
export function IssueLocationMap({ latitude, longitude, categoryId }: { latitude: number; longitude: number; categoryId: number }) {
  return (
    <BaseMap label="Map showing the issue location" center={[latitude, longitude]} zoom={PICKED_ZOOM} className="h-64" scrollWheelZoom={false}>
      <Marker position={[latitude, longitude]} icon={pinIcon(colorForCategory(categoryId))} />
    </BaseMap>
  )
}

export default IssueLocationMap
