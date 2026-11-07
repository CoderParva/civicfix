/**
 * MapLibre GL decodes vector tiles in a Web Worker. It finds the worker file relative to its own
 * module URL, which breaks once a bundler moves/pre-bundles it ("Worker failed to load" and a map
 * with markers but no roads). Having Vite build the worker as its own asset and handing MapLibre
 * that URL fixes it in both `npm run dev` and the production build.
 *
 * Imported for its side effect by BaseMap. Tests stub this module (jsdom has no WebGL or workers).
 */
import { setWorkerUrl } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'

setWorkerUrl(workerUrl)
