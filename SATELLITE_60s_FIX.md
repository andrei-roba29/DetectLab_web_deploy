# Satellite Imagery 60's Layer — Fix Summary

## Problem
The "Satellite imagery 60's" layer was only showing **3 random sheets** instead of covering the entire surface of Romania. The red coverage polygon was also limited to a small area in western Romania.

## Root Causes

### 1. Hardcoded Non-Existent Frame Names
The code referenced two CORONA satellite passes:
- `1106-1042` 
- `1104-2155`

Then it dynamically generated frame names from `df012` to `df026` and `da012` to `da026` for each pass (58 layer names total).

**The problem**: When querying the CAST UARK GeoServer's GetCapabilities, only **3 frames actually exist** on the server:
- `corona:1106-1042da023`
- `corona:1106-1042da024`
- `corona:1106-1042da025`

All other 55+ generated layer names don't exist, so the WMS server returns empty tiles for them. This is why only 3 sheets appeared.

### 2. Wrong Coverage Bounds
The coverage polygon was defined as:
```javascript
bounds: [[43.0688, 16.8750], [46.1500, 21.1000]]
```

This covers approximately:
- Latitude: 43.07°N to 46.15°N
- Longitude: 16.88°E to 21.10°E

This area is in the **western Balkans/Adriatic region**, covering only the western edge of Romania.

**Romania's actual extent**:
- Latitude: ~43.6°N to ~48.3°N
- Longitude: ~20.3°E to ~29.7°E

So ~2/3 of Romania (the eastern part) had no coverage polygon at all.

### 3. Wrong Pass Selection
The passes `1106-1042` and `1104-2155` have ground tracks over western Europe and barely touch western Romania. They don't provide comprehensive coverage of the country.

## Solution

### 1. Dynamic Layer Discovery
Instead of hardcoding pass names and generating bogus frame numbers, the layer now **dynamically discovers all available Corona layers** from the CAST GeoServer at page load:

```javascript
function discoverCoronaLayers(callback) {
    fetch(SAT60_WMS_URL + "?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetCapabilities")
        .then(function (r) { return r.text(); })
        .then(function (xml) {
            var layers = [];
            var re = /<Name>(corona:[^<]+)<\/Name>/g;
            var match;
            while ((match = re.exec(xml)) !== null) {
                var name = match[1];
                // Skip metadata/index layers
                if (name.indexOf("footprints") !== -1) continue;
                layers.push(name);
            }
            console.log("[Sat60] Discovered", layers.length, "Corona WMS layers");
            callback(layers);
        })
        .catch(function (err) {
            console.warn("[Sat60] Failed to discover, using fallback list");
            // Fallback: hardcoded list of known-good passes for Romania
            callback([...]);
        });
}
```

This discovers **hundreds of Corona frames** across many passes that actually exist on the server.

### 2. Updated Coverage Bounds
Changed from:
```javascript
bounds: [[43.0688, 16.8750], [46.1500, 21.1000]]  // Western Balkans only
```

To:
```javascript
bounds: [[43.5, 19.5], [48.5, 30.5]]  // All of Romania
```

This now covers the full extent of Romania.

### 3. Async Layer Loading
Since layer discovery is asynchronous (requires fetching GetCapabilities), the code now:
1. Starts discovery at page load
2. Sets `window._sat60Ready = false` initially
3. When discovery completes, rebuilds the layer group with all discovered layers
4. If the toggle was already switched on before discovery finished, adds the layers to the map automatically

## Files Modified
- `/home/user/DetectLab_web_deploy/js/map-app.js`
  - Lines ~7700-7710: Updated `satellite60s` coverage bounds
  - Lines ~8077-8175: Replaced entire Satellite 60s layer implementation

## Testing
After the fix:
1. Open the map and toggle on "Satellite imagery 60's"
2. Check browser console for: `[Sat60] Discovered X Corona WMS layers from CAST GeoServer`
3. You should see CORONA imagery covering all of Romania, not just 3 sheets in the west
4. The red coverage polygon should span from ~19.5°E to ~30.5°E (all of Romania)

## Fallback
If the GetCapabilities request fails (network error, CORS issue, etc.), the code falls back to a hardcoded list of known-good passes that cover Romania:
- 1103-2139, 1103-2155, 1103-2167, 1103-2171, 1103-2183, 1103-2200
- 1106-1042 (the 3 frames that exist)
- 1106-2070, 1106-2119, 1107-2170, 1108-2135, 1108-2167

These passes were identified from the GeoServer capabilities as having multiple frames covering Romanian territory.

## Notes
- The CORONA satellite program (1960-1972) produced high-resolution imagery of Cold War hotspots, including extensive coverage of Romania
- The CAST (Center for Advanced Spatial Technologies) at University of Arkansas has orthorectified and published this imagery via WMS
- Each "pass" is a satellite revolution with fore/aft cameras producing multiple frames
- Frame naming: `df` = fore camera, `da` = aft camera, followed by frame number
- The GeoServer has hundreds of layers, most of which are not relevant to Romania, but the dynamic discovery ensures we get all available coverage

## Performance & Request Choking Optimization (Update 2026-07-31)
- **Problem**: When dynamic discovery loaded successfully, it returned almost ~2,000 layers. Creating a separate `L.tileLayer.wms` instance for each of these layers resulted in Leaflet making ~2,000 WMS tile requests for *each* grid tile on the map. In typical viewports with ~24 grid tiles, this caused Leaflet to attempt over 44,000 requests simultaneously, choking browser network resources and blocking the map from loading.
- **Solution**: Implemented a **chunking optimization** that batches the discovered layers into groups of 50. Instead of 2,000 separate WMS layers, it creates 40 layers, each joining 50 layer names with a comma (e.g. `corona:pass1,corona:pass2,...`). This is standard for WMS, where the server composites the layers internally and returns a single combined tile.
- **Result**: The number of requests is reduced by 50x (from 44,000+ to under 1,000 total across the view), resolving the browser lock-up and allowing the Satellite imagery 60's layers to load instantly and smoothly. URL lengths remain well under safe proxy/server limits (~1,200 characters).
