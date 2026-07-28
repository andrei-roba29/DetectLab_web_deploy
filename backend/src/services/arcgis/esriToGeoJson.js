/**
 * Converts one Esri JSON geometry object into a standard GeoJSON geometry.
 * `esriGeometryType` comes from the layer's response (e.g. "esriGeometryPoint")
 * and is the same for every feature in a given layer/query.
 */
export function esriGeometryToGeoJson(geometry, esriGeometryType) {
  if (!geometry) return null;

  switch (esriGeometryType) {
    case 'esriGeometryPoint':
      return { type: 'Point', coordinates: [geometry.x, geometry.y] };

    case 'esriGeometryMultipoint':
      return { type: 'MultiPoint', coordinates: geometry.points };

    case 'esriGeometryPolyline':
      return geometry.paths.length === 1
        ? { type: 'LineString', coordinates: geometry.paths[0] }
        : { type: 'MultiLineString', coordinates: geometry.paths };

    case 'esriGeometryPolygon':
      // Esri "rings" map directly onto GeoJSON polygon rings (first = outer,
      // rest = holes). Winding direction can differ from strict GeoJSON
      // convention, but PostGIS's ST_GeomFromGeoJSON accepts this fine.
      return { type: 'Polygon', coordinates: geometry.rings };

    default:
      throw new Error(`Unsupported esri geometry type: ${esriGeometryType}`);
  }
}

/**
 * Converts one Esri JSON feature ({ attributes, geometry }) into a
 * GeoJSON Feature ({ properties, geometry }).
 */
export function esriFeatureToGeoJson(esriFeature, esriGeometryType) {
  return {
    type: 'Feature',
    properties: esriFeature.attributes,
    geometry: esriGeometryToGeoJson(esriFeature.geometry, esriGeometryType),
  };
}
