# Data sources and licences

| Preset | Locations | Source (licence) | Collected | Notes |
|---|---|---|---|---|
| Taco Bell · USA | 8,288 | All the Places spider `taco_bell_us` (CC0), run 2026-10-31-13-32-34 | 2026-11-05 | Originally from locations.tacobell.com. The Short used a direct locator scrape (8,297); this app uses the CC0 copy. |
| McDonald's · USA | 13,486 | All the Places spider `mcdonalds`, US features (CC0), snapshot 2026-10-10 | 2026-10-10 | Same file as the McDonald's USA Short. |
| Dunkin' · New England | 2,086 | All the Places spider `dunkin_us` (CC0), ME/NH/VT/MA/RI/CT | 2026-11-01 | Same file as the Dunkin' Short. |
| KFC · Malaysia | 747 | All the Places spider `kfc_my` (CC0) | 2026-11-03 | 753 features. Excluded the same 6 listings the Short excluded (every service flag off); one of them, KFC KLIA, also has no coordinates in the snapshot. KFC Pasir Gudang moved to its street address (OSM Nominatim), as in the Short. The Short used the official locator (745). |
| McDonald's · Malaysia | 382 | All the Places spider `mcdonalds_my` (CC0), latest available output | 2026-10-27 | 4 pins corrected exactly as in the Short. State labels from geoBoundaries ADM1 polygons (CC BY 4.0). The Short used the official locator (388). |

Raw downloads used to build the presets are in `data_src/`. They aren't needed at runtime, so leave them out of a deploy. Rebuild with `python3 tools/prep_data.py`.

**Default assumptions per preset** (editable in the app):
- Road factor and average speed were measured on our own OSRM-routed Shorts as OSRM road km ÷ straight-line km over the drive legs, and OSRM km ÷ OSRM hours:
  - Taco Bell 1.287 and 38.6 mph
  - McD USA 1.305 and 37.1 mph
  - Dunkin' 1.383 and 29.8 mph
  - KFC MY 1.576 and 58.0 km/h
  - McD MY 1.525 and 59.5 km/h
- Custom lists default to 1.3 and 37.1 mph. These are labelled as assumptions.
- 10 min per stop.
- Fuel:
  - US: 25 mpg at US$3.943/gal (AAA national average for regular, 11 Nov 2026).
  - Malaysia: 7 L/100 km at RM1.99/L (BUDI95 subsidised RON95, week of 12–18 Nov 2026; unsubsidised RM3.87/L).
- Flight and ferry hops between landmasses (Alaska, each Hawaiian island, Borneo, Labuan, Langkawi) aren't counted in distance or time.

**Map and poster:**
- Interactive tiles: OpenFreeMap "dark" style. © OpenMapTiles, © OpenStreetMap contributors (ODbL).
- Poster basemap: Natural Earth 50m admin-0 and US admin-1 (public domain).
- Fonts: Barlow Condensed and Inter (SIL Open Font License 1.1, see fonts/LICENSE.md).
- MapLibre GL JS 5.24.1 (BSD-3-Clause, see `vendor/maplibre-gl/LICENSE.txt`).
