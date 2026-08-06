// Hybrid tile layer switch based on viewport overlap with Supabase bounds
const supabaseBounds = {type:"Feature",geometry:{type:"MultiPolygon",coordinates:[[[[22.70430468610034,45.247334688102356],[23.638068028777383,45.367926236897077],[24.996611657254576,45.679964670809881],[26.249853201360182,45.635471012283972],[26.253057718465055,46.434888850924899],[25.589395834608641,47.02117892481575],[24.400171056345432,47.611651301824551],[22.349260164492851,47.487719968945669],[22.70430468610034,45.247334688102356]]]]}};

function viewportIntersectsBounds(bbox) {
  // Simple bbox overlap check; replace with precise polygon-point if needed
  return true; // placeholder for real overlap logic
}

function switchLayer(map) {
  // Monitor move/zoom and switch tile layer when viewport touches supabase bounds
  map.on('move zoom', () => {
    const b = map.getBounds();
    // If any point of view overlaps supabase bounds -> supabase, else cloudflare
    const useSupabase = viewportIntersectsBounds(b);
    map.eachLayer(l => {
      if (l.options && l.options.name === 'supabase') l.setOpacity(useSupabase ? 1 : 0);
      if (l.options && l.options.name === 'cloudflare') l.setOpacity(useSupabase ? 0 : 1);
    });
  });
}
if(typeof map!=="undefined"&&map) switchLayer(map);
