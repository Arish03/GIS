# Plant Health Visualization Feature — Implementation Prompt

I want to add a plant health visualization feature to my website, inspired by WebODM's implementation. Currently I use a simple GCC (Green Chromatic Coordinate) method with 3 thresholds. I want to upgrade to support multiple vegetation index formulas with color-mapped raster rendering.

## What to implement:

### 1. Vegetation Index Formula Engine

A system that evaluates pixel-level math formulas against orthophoto band values. Support these band variables:
- `R` = Red, `G` = Green, `B` = Blue, `N` = NIR (near-infrared), `Re` = Red Edge, `L` = Thermal

Implement these formulas (at minimum):

| Index | Formula | Range | Use Case |
|-------|---------|-------|----------|
| GCC (existing) | `G / (R + G + B)` | 0–1 | Current method, keep as default for RGB |
| NDVI | `(N - R) / (N + R)` | -1 to 1 | Standard vegetation index (requires NIR band) |
| VARI | `(G - R) / (G + R - B)` | -1 to 1 | Vegetation from RGB-only imagery |
| EXG | `(2 * G) - (R + B)` | varies | Excess green, good for leafy crops |
| GLI | `((G * 2) - R - B) / ((G * 2) + R + B)` | -1 to 1 | Green leaf index |
| ENDVI | `((N + G) - (2 * B)) / ((N + G) + (2 * B))` | varies | Enhanced NDVI using blue+green |
| GNDVI | `(N - G) / (N + G)` | -1 to 1 | Green NDVI, sensitive to chlorophyll |
| SAVI | `(1.5 * (N - R)) / (N + R + 0.5)` | varies | Soil-adjusted, for sparse vegetation |
| EVI | `2.5 * (N - R) / (N + 6*R - 7.5*B + 1)` | -1 to 1 | Enhanced, avoids NDVI saturation |
| MPRI | `(G - R) / (G + R)` | -1 to 1 | Modified photochemical reflectance |
| vNDVI | `0.5268 * (R^-0.1294 * G^0.3389 * B^-0.3118)` | varies | Visible NDVI for RGB-only sensors |
| LAI | `3.618 * (2.5 * (N - R) / (N + 6*R - 7.5*B + 1)) - 0.118` | -1 to 1 | Leaf area index |

### 2. Auto-detection logic

Based on available bands in the uploaded image:
- If image has **Red + Green + NIR** bands → default to **NDVI**
- If image has only **RGB** bands → default to **VARI** (or keep GCC as default)
- If image has a single **thermal** band → show temperature (Celsius = `L`)
- Let the user switch formulas via a dropdown

### 3. Color map rendering

Apply a color gradient to the computed index values per pixel:
- Default color map: **RdYlGn** (Red → Yellow → Green) for vegetation indices
- Support at least these palettes: `rdylgn`, `spectral`, `viridis`, `jet`, `magma`
- For a custom discrete NDVI map, use these hex stops:
  ```
  ['#AD0028', '#C5142A', '#E02D2C', '#EF4C3A', '#FE6C4A', '#FF8D5A', '#FFAB69',
   '#FFC67D', '#FFE093', '#FFEFAB', '#FDFEC2', '#EAF7AC', '#D5EF94', '#B9E383',
   '#9BD873', '#77CA6F', '#53BD6B', '#14AA60', '#009755', '#007E47']
  ```
- Map the formula output range (e.g. -1 to 1) linearly onto the color palette
- Render as a colored overlay on the map tile layer

### 4. UI components needed

- A "Plant Health" toggle/tab on the map view
- A **formula selector** dropdown listing available indices (filtered by available bands)
- A **color map selector** dropdown
- A **color legend/scale bar** showing the gradient with min/max values
- Each formula should show a tooltip/help text explaining what it measures

### 5. Processing approach

- **Option A (server-side):** Process the raster with a tiling server (e.g. using `rasterio`, `numpy`, or `titiler`) — evaluate the formula per pixel, apply the color map, return PNG tiles
- **Option B (client-side):** If images are small, use JavaScript canvas or WebGL to apply formulas in the browser
- Choose whichever fits my existing stack

## Requirements:

- The formula engine should be extensible — easy to add new formulas as a dictionary/config
- Normalize band values to 0–1 range before applying formulas
- Handle division-by-zero gracefully (output 0 or NaN → transparent pixel)
- Keep the existing GCC classification thresholds as an optional overlay mode