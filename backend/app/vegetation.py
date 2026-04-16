"""
Vegetation Index engine — server-side tile renderer.

Reads the ortho GeoTIFF, evaluates a chosen vegetation index formula per-pixel,
applies a colour-map, and returns 256×256 PNG tiles via an XYZ endpoint.
"""

import io
import math
import os
from functools import lru_cache
from typing import Optional

import numpy as np
import rasterio
from rasterio.windows import Window, from_bounds
from rasterio.warp import transform_bounds
from PIL import Image

# ── Colour palettes ──────────────────────────────────────────

PALETTES = {
    "rdylgn": [
        (173, 0, 40), (197, 20, 42), (224, 45, 44), (239, 76, 58),
        (254, 108, 74), (255, 141, 90), (255, 171, 105), (255, 198, 125),
        (255, 224, 147), (255, 239, 171), (253, 254, 194), (234, 247, 172),
        (213, 239, 148), (185, 227, 131), (155, 216, 115), (119, 202, 111),
        (83, 189, 107), (20, 170, 96), (0, 151, 85), (0, 126, 71),
    ],
    "spectral": [
        (158, 1, 66), (185, 31, 69), (213, 62, 79), (232, 96, 59),
        (244, 141, 64), (253, 184, 99), (254, 222, 141), (254, 254, 189),
        (231, 245, 161), (193, 225, 138), (148, 206, 112), (98, 182, 115),
        (69, 161, 124), (49, 134, 133), (33, 102, 172), (48, 67, 155),
    ],
    "viridis": [
        (68, 1, 84), (72, 23, 105), (72, 43, 115), (67, 62, 133),
        (57, 82, 139), (46, 100, 142), (38, 115, 140), (30, 131, 137),
        (26, 147, 130), (34, 163, 118), (55, 178, 102), (82, 191, 83),
        (122, 202, 57), (164, 210, 36), (204, 216, 26), (243, 229, 30),
    ],
    "jet": [
        (0, 0, 127), (0, 0, 255), (0, 63, 255), (0, 127, 255),
        (0, 191, 255), (0, 255, 255), (63, 255, 191), (127, 255, 127),
        (191, 255, 63), (255, 255, 0), (255, 191, 0), (255, 127, 0),
        (255, 63, 0), (255, 0, 0), (191, 0, 0), (127, 0, 0),
    ],
    "magma": [
        (0, 0, 4), (12, 7, 39), (32, 12, 73), (56, 15, 101),
        (82, 16, 119), (107, 22, 127), (132, 34, 128), (157, 47, 127),
        (181, 62, 118), (202, 81, 104), (218, 104, 88), (231, 129, 73),
        (240, 158, 59), (246, 189, 48), (249, 220, 63), (252, 253, 191),
    ],
}


def _build_lut(palette_name: str) -> np.ndarray:
    """Build a 256-entry RGB lookup table from a named palette."""
    palette = PALETTES.get(palette_name, PALETTES["rdylgn"])
    n = len(palette)
    lut = np.zeros((256, 3), dtype=np.uint8)
    for i in range(256):
        t = i / 255.0 * (n - 1)
        lo = int(t)
        hi = min(lo + 1, n - 1)
        frac = t - lo
        for c in range(3):
            lut[i, c] = int(palette[lo][c] * (1 - frac) + palette[hi][c] * frac)
    return lut


# Pre-build LUTs
_LUTS = {name: _build_lut(name) for name in PALETTES}


# ── Vegetation Index Formulas ────────────────────────────────

INDICES = {
    # RGB-only
    "GCC":   {"formula": "gcc",   "range": (0, 1),     "bands": ["R", "G", "B"], "label": "Green Chromatic Coordinate", "desc": "Greenness ratio from RGB"},
    "VARI":  {"formula": "vari",  "range": (-1, 1),    "bands": ["R", "G", "B"], "label": "Visible Atmospherically Resistant Index", "desc": "Vegetation from RGB-only imagery"},
    "EXG":   {"formula": "exg",   "range": (-2, 2),    "bands": ["R", "G", "B"], "label": "Excess Green Index", "desc": "Emphasizes green vegetation"},
    "GLI":   {"formula": "gli",   "range": (-1, 1),    "bands": ["R", "G", "B"], "label": "Green Leaf Index", "desc": "Green leaf detection"},
    "MPRI":  {"formula": "mpri",  "range": (-1, 1),    "bands": ["R", "G", "B"], "label": "Modified Photochemical Reflectance Index", "desc": "Photochemical reflectance for RGB"},
    "vNDVI": {"formula": "vndvi", "range": (0, 1.5),   "bands": ["R", "G", "B"], "label": "Visible NDVI", "desc": "NDVI approximation from RGB sensors"},
    # Requires NIR
    "NDVI":  {"formula": "ndvi",  "range": (-1, 1),   "bands": ["R", "N"],       "label": "Normalized Difference Vegetation Index", "desc": "Standard vegetation index (requires NIR)"},
    "GNDVI": {"formula": "gndvi", "range": (-1, 1),   "bands": ["G", "N"],       "label": "Green NDVI", "desc": "Chlorophyll-sensitive (requires NIR)"},
    "SAVI":  {"formula": "savi",  "range": (-1.5, 1.5), "bands": ["R", "N"],     "label": "Soil-Adjusted Vegetation Index", "desc": "For sparse vegetation (requires NIR)"},
    "EVI":   {"formula": "evi",   "range": (-1, 1),   "bands": ["R", "G", "B", "N"], "label": "Enhanced Vegetation Index", "desc": "Avoids NDVI saturation (requires NIR)"},
    "ENDVI": {"formula": "endvi", "range": (-1, 1),   "bands": ["N", "G", "B"], "label": "Enhanced NDVI", "desc": "Enhanced using blue+green (requires NIR)"},
    "LAI":   {"formula": "lai",   "range": (-1, 6),   "bands": ["R", "G", "B", "N"], "label": "Leaf Area Index", "desc": "Canopy coverage (requires NIR)"},
}


def _safe_divide(num, den):
    """Element-wise division, returns 0.0 where denominator is 0."""
    with np.errstate(divide='ignore', invalid='ignore'):
        result = np.where(den != 0, num / den, 0.0)
    return result


def compute_index(R, G, B, N, formula: str) -> np.ndarray:
    """Compute the vegetation index. Bands are float64 in [0, 1]."""
    if formula == "gcc":
        total = R + G + B
        return _safe_divide(G, total)
    elif formula == "vari":
        den = G + R - B
        return _safe_divide(G - R, den)
    elif formula == "exg":
        return 2.0 * G - R - B
    elif formula == "gli":
        num = 2.0 * G - R - B
        den = 2.0 * G + R + B
        return _safe_divide(num, den)
    elif formula == "mpri":
        return _safe_divide(G - R, G + R)
    elif formula == "vndvi":
        with np.errstate(divide='ignore', invalid='ignore'):
            result = 0.5268 * np.power(np.clip(R, 1e-10, None), -0.1294) * \
                     np.power(np.clip(G, 1e-10, None), 0.3389) * \
                     np.power(np.clip(B, 1e-10, None), -0.3118)
        return np.nan_to_num(result, 0.0)
    elif formula == "ndvi":
        return _safe_divide(N - R, N + R)
    elif formula == "gndvi":
        return _safe_divide(N - G, N + G)
    elif formula == "savi":
        return _safe_divide(1.5 * (N - R), N + R + 0.5)
    elif formula == "evi":
        den = N + 6.0 * R - 7.5 * B + 1.0
        return _safe_divide(2.5 * (N - R), den)
    elif formula == "endvi":
        num = (N + G) - 2.0 * B
        den = (N + G) + 2.0 * B
        return _safe_divide(num, den)
    elif formula == "lai":
        evi_val = _safe_divide(2.5 * (N - R), N + 6.0 * R - 7.5 * B + 1.0)
        return 3.618 * evi_val - 0.118
    else:
        return _safe_divide(G, R + G + B)  # fallback to GCC


def detect_available_bands(raster_path: str) -> dict:
    """Detect which spectral bands are available in the raster."""
    with rasterio.open(raster_path) as ds:
        count = ds.count
        descriptions = [d.lower() if d else "" for d in ds.descriptions]

    bands = {"R": None, "G": None, "B": None, "N": None, "Re": None, "L": None}

    # Try descriptions first
    band_keywords = {
        "R": ["red"], "G": ["green"], "B": ["blue"],
        "N": ["nir", "near-infrared", "near infrared"],
        "Re": ["rededge", "red edge", "red-edge"],
        "L": ["thermal", "lwir"],
    }
    for band_name, keywords in band_keywords.items():
        for i, desc in enumerate(descriptions):
            if any(kw in desc for kw in keywords):
                bands[band_name] = i + 1  # 1-based
                break

    # Fallback: assume standard RGB ordering for first 3-4 bands
    if bands["R"] is None and count >= 3:
        bands["R"] = 1
        bands["G"] = 2
        bands["B"] = 3
    if bands["N"] is None and count >= 5:
        bands["N"] = 5  # Common for multispectral: R,G,B,RE,NIR
    elif bands["N"] is None and count == 4:
        # Could be RGBA or RGBN — check if band 4 description hints alpha
        if count == 4 and (len(descriptions) < 4 or "alpha" not in descriptions[3]):
            # Don't assume band 4 is NIR if descriptions say nothing
            pass

    return bands


def get_available_indices(raster_path: str) -> list:
    """Return list of index names available given the raster's bands."""
    bands = detect_available_bands(raster_path)
    has = {k for k, v in bands.items() if v is not None}
    available = []
    for name, info in INDICES.items():
        required = set(info["bands"])
        if required.issubset(has):
            available.append({
                "name": name,
                "label": info["label"],
                "desc": info["desc"],
                "range": info["range"],
            })
    return available


# ── Tile Rendering ───────────────────────────────────────────

def _tile_bounds(z: int, x: int, y: int):
    """Convert XYZ tile to EPSG:4326 bounds (west, south, east, north)."""
    n = 2 ** z
    west = x / n * 360.0 - 180.0
    east = (x + 1) / n * 360.0 - 180.0
    north = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    south = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 1) / n))))
    return west, south, east, north


def render_index_tile(
    ortho_path: str,
    z: int, x: int, y: int,
    index_name: str = "VARI",
    palette_name: str = "rdylgn",
    tile_size: int = 256,
) -> Optional[bytes]:
    """
    Render a single 256×256 PNG tile for the given vegetation index.
    Returns PNG bytes or None if tile is outside raster bounds.
    """
    idx_info = INDICES.get(index_name, INDICES["VARI"])
    formula = idx_info["formula"]
    vmin, vmax = idx_info["range"]

    lut = _LUTS.get(palette_name, _LUTS["rdylgn"])

    tile_west, tile_south, tile_east, tile_north = _tile_bounds(z, x, y)

    with rasterio.open(ortho_path) as ds:
        # Transform full tile bounds to raster CRS
        raster_crs = ds.crs
        try:
            full_left, full_bottom, full_right, full_top = transform_bounds(
                "EPSG:4326", raster_crs,
                tile_west, tile_south, tile_east, tile_north,
            )
        except Exception:
            return None

        # Check overlap with raster extent
        r_left, r_bottom, r_right, r_top = ds.bounds
        if full_left >= r_right or full_right <= r_left or full_bottom >= r_top or full_top <= r_bottom:
            return None

        # Clip to raster bounds
        clip_left = max(full_left, r_left)
        clip_bottom = max(full_bottom, r_bottom)
        clip_right = min(full_right, r_right)
        clip_top = min(full_top, r_top)

        # Compute pixel region within the 256×256 tile for the clipped area
        tile_w = full_right - full_left
        tile_h = full_top - full_bottom
        if tile_w <= 0 or tile_h <= 0:
            return None

        px_left = int(round((clip_left - full_left) / tile_w * tile_size))
        px_right = int(round((clip_right - full_left) / tile_w * tile_size))
        px_top = int(round((full_top - clip_top) / tile_h * tile_size))
        px_bottom = int(round((full_top - clip_bottom) / tile_h * tile_size))

        sub_w = max(px_right - px_left, 1)
        sub_h = max(px_bottom - px_top, 1)

        # Compute raster window
        win = from_bounds(clip_left, clip_bottom, clip_right, clip_top, transform=ds.transform)
        win = win.round_offsets().round_lengths()
        if win.width <= 0 or win.height <= 0:
            return None

        # Read bands into sub-tile sized arrays
        bands = detect_available_bands(ortho_path)

        def read_band(key):
            idx = bands.get(key)
            if idx is None:
                return np.zeros((sub_h, sub_w), dtype=np.float64)
            data = ds.read(idx, window=win, out_shape=(sub_h, sub_w),
                           resampling=rasterio.enums.Resampling.bilinear)
            return data.astype(np.float64) / 255.0 if ds.dtypes[idx - 1] == 'uint8' else data.astype(np.float64)

        R = read_band("R")
        G = read_band("G")
        B = read_band("B")
        N = read_band("N")

        # Read alpha if present
        alpha_sub = None
        if ds.count >= 4:
            alpha_sub = ds.read(ds.count, window=win, out_shape=(sub_h, sub_w),
                                resampling=rasterio.enums.Resampling.nearest)

    # Compute index on the sub-tile
    values = compute_index(R, G, B, N, formula)

    # Normalize to 0-255 range
    norm = np.clip((values - vmin) / (vmax - vmin), 0.0, 1.0)
    indices_8bit = (norm * 255).astype(np.uint8)

    # Apply colour map via LUT
    sub_rgb = lut[indices_8bit]  # shape: (sub_h, sub_w, 3)

    # Build alpha for the sub-tile
    sub_alpha = np.full((sub_h, sub_w), 200, dtype=np.uint8)
    if alpha_sub is not None:
        sub_alpha = np.where(alpha_sub > 0, 200, 0).astype(np.uint8)
    else:
        zero_mask = (R == 0) & (G == 0) & (B == 0)
        sub_alpha = np.where(zero_mask, 0, 200).astype(np.uint8)

    # Composite into full 256×256 tile (transparent background)
    rgba = np.zeros((tile_size, tile_size, 4), dtype=np.uint8)
    rgba[px_top:px_top + sub_h, px_left:px_left + sub_w, :3] = sub_rgb
    rgba[px_top:px_top + sub_h, px_left:px_left + sub_w, 3] = sub_alpha

    img = Image.fromarray(rgba, 'RGBA')

    buf = io.BytesIO()
    img.save(buf, format='PNG', optimize=True)
    return buf.getvalue()


def render_ortho_tile(
    ortho_path: str,
    z: int, x: int, y: int,
    tile_size: int = 256,
) -> Optional[bytes]:
    """
    Render a single 256x256 RGBA PNG tile directly from the ortho GeoTIFF.
    Returns PNG bytes or None if tile is fully outside raster bounds.
    """
    tile_west, tile_south, tile_east, tile_north = _tile_bounds(z, x, y)

    with rasterio.open(ortho_path) as ds:
        raster_crs = ds.crs
        try:
            full_left, full_bottom, full_right, full_top = transform_bounds(
                "EPSG:4326", raster_crs,
                tile_west, tile_south, tile_east, tile_north,
            )
        except Exception:
            return None

        r_left, r_bottom, r_right, r_top = ds.bounds
        if full_left >= r_right or full_right <= r_left or full_bottom >= r_top or full_top <= r_bottom:
            return None

        clip_left = max(full_left, r_left)
        clip_bottom = max(full_bottom, r_bottom)
        clip_right = min(full_right, r_right)
        clip_top = min(full_top, r_top)

        tile_w = full_right - full_left
        tile_h = full_top - full_bottom
        if tile_w <= 0 or tile_h <= 0:
            return None

        px_left = int(round((clip_left - full_left) / tile_w * tile_size))
        px_right = int(round((clip_right - full_left) / tile_w * tile_size))
        px_top = int(round((full_top - clip_top) / tile_h * tile_size))
        px_bottom = int(round((full_top - clip_bottom) / tile_h * tile_size))

        sub_w = max(px_right - px_left, 1)
        sub_h = max(px_bottom - px_top, 1)

        win = from_bounds(clip_left, clip_bottom, clip_right, clip_top, transform=ds.transform)
        win = win.round_offsets().round_lengths()
        if win.width <= 0 or win.height <= 0:
            return None

        band_map = detect_available_bands(ortho_path)

        def read_u8(key):
            idx = band_map.get(key)
            if idx is None:
                return np.zeros((sub_h, sub_w), dtype=np.uint8)
            data = ds.read(idx, window=win, out_shape=(sub_h, sub_w),
                           resampling=rasterio.enums.Resampling.bilinear)
            if ds.dtypes[idx - 1] != 'uint8':
                dmin = float(np.nanmin(data))
                dmax = float(np.nanmax(data))
                span = max(dmax - dmin, 1.0)
                data = np.clip((data.astype(np.float32) - dmin) / span * 255, 0, 255)
            return data.astype(np.uint8)

        r_band = read_u8("R")
        g_band = read_u8("G")
        b_band = read_u8("B")

        alpha_sub = None
        if ds.count >= 4:
            alpha_sub = ds.read(ds.count, window=win, out_shape=(sub_h, sub_w),
                                resampling=rasterio.enums.Resampling.nearest)

    rgba = np.zeros((tile_size, tile_size, 4), dtype=np.uint8)
    rgba[px_top:px_top + sub_h, px_left:px_left + sub_w, 0] = r_band
    rgba[px_top:px_top + sub_h, px_left:px_left + sub_w, 1] = g_band
    rgba[px_top:px_top + sub_h, px_left:px_left + sub_w, 2] = b_band

    if alpha_sub is not None:
        rgba[px_top:px_top + sub_h, px_left:px_left + sub_w, 3] = np.where(
            alpha_sub > 0, 255, 0
        ).astype(np.uint8)
    else:
        mask = (r_band > 0) | (g_band > 0) | (b_band > 0)
        rgba[px_top:px_top + sub_h, px_left:px_left + sub_w, 3] = np.where(
            mask, 255, 0
        ).astype(np.uint8)

    img = Image.fromarray(rgba, 'RGBA')
    buf = io.BytesIO()
    img.save(buf, format='PNG', optimize=False)
    return buf.getvalue()
