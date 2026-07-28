/**
 * Every ArcGIS layer we mirror into PostGIS. Adding a new layer to sync
 * is as simple as adding an entry here — nothing else in the sync
 * pipeline needs to change, since it's already generic per-layer.
 */
export const SYNC_LAYERS = [
  { id: 0, key: 'sites', label: 'Repertoriul arheologic national (puncte)' },
  { id: 5, key: 'tumuli', label: 'Tumuli' },
  { id: 6, key: 'site_boundaries', label: 'Repertoriul arheologic national (poligoane)' },
];
