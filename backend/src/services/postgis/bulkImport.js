import { from as copyFrom } from 'pg-copy-streams';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { esriFeatureToGeoJson } from '../arcgis/esriToGeoJson.js';
import { geoJsonToWkt } from './geoJsonToWkt.js';
import { logger } from '../../logger.js';

/** Escapes one value for CSV (the format COPY reads from stdin). */
function csvField(value) {
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Bulk-inserts a batch of raw Esri JSON features into the given table
 * using PostgreSQL's COPY protocol — dramatically faster than one
 * INSERT per row, which matters once we're doing this for ~29,000
 * (eventually 500,000+) features every night.
 */
export async function bulkInsertEsriFeatures(
  client,
  tableName,
  esriFeatures,
  geometryType,
  layerId,
  layerName,
  objectIdFieldName = 'OBJECTID'
) {
  const rows = esriFeatures
    .filter((esriFeature) => {
      const hasId = esriFeature.attributes[objectIdFieldName] != null;
      if (!hasId) {
        logger.warn({ objectIdFieldName, attributes: esriFeature.attributes }, 'Skipping feature with missing ID');
      }
      return hasId;
    })
    .map((esriFeature) => {
      const geoJsonFeature = esriFeatureToGeoJson(esriFeature, geometryType);
      const objectId = esriFeature.attributes[objectIdFieldName];
      const attributesJson = JSON.stringify(esriFeature.attributes);

      const coords = geoJsonFeature.geometry?.coordinates;
      const hasGeometry = Array.isArray(coords) ? coords.length > 0 : coords != null;
      if (geoJsonFeature.geometry && !hasGeometry) {
        logger.warn({ objectId, layerId }, 'Feature has empty geometry (e.g. rings:[]) — storing with no shape');
      }

      const wkt = hasGeometry ? `SRID=4326;${geoJsonToWkt(geoJsonFeature.geometry)}` : '';

      return [
        csvField(layerId),
        csvField(layerName),
        csvField(objectId),
        csvField(attributesJson),
        csvField(wkt),
      ].join(',');
    });

  const csvText = rows.join('\n') + '\n';

  const copyStream = client.query(
    copyFrom(
      `COPY ${tableName} (layer_id, layer_name, object_id, attributes, geom) FROM STDIN WITH (FORMAT csv)`
    )
  );

  await pipeline(Readable.from([csvText]), copyStream);

  return rows.length;
}
