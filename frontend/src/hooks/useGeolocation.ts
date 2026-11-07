import { useCallback, useState } from 'react'

export interface Coordinates {
  latitude: number
  longitude: number
}

type GeoStatus = 'idle' | 'locating' | 'error'

const MESSAGES: Record<number, string> = {
  1: 'Location permission was denied. Enter the coordinates manually.',
  2: 'Your location could not be determined. Enter the coordinates manually.',
  3: 'Finding your location timed out. Try again or enter the coordinates manually.',
}

/** Wraps the browser Geolocation API; `locate` resolves with the position or null on failure. */
export function useGeolocation() {
  const [status, setStatus] = useState<GeoStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  const locate = useCallback((): Promise<Coordinates | null> => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setStatus('error')
      setError('This browser does not support location. Enter the coordinates manually.')
      return Promise.resolve(null)
    }
    setStatus('locating')
    setError(null)
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setStatus('idle')
          resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude })
        },
        (err) => {
          setStatus('error')
          setError(MESSAGES[err.code] ?? MESSAGES[2])
          resolve(null)
        },
        { enableHighAccuracy: true, timeout: 10_000 },
      )
    })
  }, [])

  return { locate, locating: status === 'locating', error }
}
