/**
 * Converts a GeoJSON geometry object into WKT (Well-Known Text), the
 * text format PostGIS's geometry column understands natively. We need
 * this because the fast bulk-load path (COPY) can't call SQL functions
 * like ST_GeomFromGeoJSON — it needs the geometry already as text that
 * PostGIS's own geometry parser accepts.
 */
export function geoJsonToWkt(geometry) {
  const ring = (coords) => `(${coords.map((c) => c.join(' ')).join(',')})`;

  switch (geometry.type) {
    case 'Point':
      return `POINT(${geometry.coordinates.join(' ')})`;

    case 'MultiPoint':
      return `MULTIPOINT(${geometry.coordinates.map((c) => `(${c.join(' ')})`).join(',')})`;

    case 'LineString':
      return `LINESTRING(${geometry.coordinates.map((c) => c.join(' ')).join(',')})`;

    case 'MultiLineString':
      return `MULTILINESTRING(${geometry.coordinates.map(ring).join(',')})`;

    case 'Polygon':
      return `POLYGON(${geometry.coordinates.map(ring).join(',')})`;

    case 'MultiPolygon':
      return `MULTIPOLYGON(${geometry.coordinates
        .map((poly) => `(${poly.map(ring).join(',')})`)
        .join(',')})`;

    default:
      throw new Error(`Unsupported GeoJSON geometry type: ${geometry.type}`);
  }
}
