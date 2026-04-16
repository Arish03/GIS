import os
import pandas as pd
import numpy as np
import rasterio
from rasterio.windows import from_bounds
from pyproj import Transformer

# =========================
# INPUT / OUTPUT
# =========================
XLSX_IN  = "input/geo_detections.xlsx"
CHM_TIF  = "input/chm.tif"

OUT_DIR = "output"          # <-- your output folder name
XLSX_OUT  = os.path.join(OUT_DIR, "geo_detections_tree_heights.xlsx")
os.makedirs(OUT_DIR, exist_ok=True)

# =========================
# TREE HEIGHT SETTINGS
# =========================
# Ignore non-tree / invalid CHM pixels
IGNORE_LEQ_ZERO = True

# Robust height estimate (recommended for 5cm CHM to avoid spikes)
HEIGHT_PERCENTILE = 98  # try 95, 97, 98, 99

# Hard cap to remove obvious spikes/outliers (set based on your orchard)
# If you expect ~6-10m trees, 20m is a safe spike cap.
MAX_CAP_METERS = 10.0

# Optional: shrink bbox to reduce neighboring-tree contamination
# 0.10 means shrink bounds by 10% on each side (use 0.0 to disable)
SHRINK_FRACTION = 0.50


def compute_tree_stats(vals_1d: np.ndarray,
                       ignore_leq_zero: bool = True,
                       max_cap: float = 20.0,
                       q: int = 98,
                       crown_threshold_ratio: float = 0.80): # <-- New parameter
    """
    Returns: (height_q, max_clipped, mean_crown, median_crown, count)
    """
    v = vals_1d.astype(np.float64)
    v = v[np.isfinite(v)]

    # 1. Standard filtering
    if ignore_leq_zero:
        v = v[v > 0]
    if max_cap is not None:
        v = v[v < max_cap]

    if v.size == 0:
        return (np.nan, np.nan, np.nan, np.nan, 0)

    # 2. Get the robust Apex (Top of the tree)
    height_q = float(np.percentile(v, q))
    max_clipped = float(v.max())
    
    # 3. CROWN ISOLATION
    # Only look at pixels that belong to the top portion of the tree
    # If the tree apex is 10m, and ratio is 0.60, we only average pixels > 6m.
    crown_cutoff = height_q * crown_threshold_ratio
    crown_pixels = v[v >= crown_cutoff]
    
    # Fallback just in case something weird happens
    if crown_pixels.size == 0:
        crown_pixels = v

    # 4. Calculate Mean/Median ONLY on the isolated crown
    mean_crown = float(crown_pixels.mean())
    median_crown = float(np.median(crown_pixels))
    
    # We return v.size (total valid pixels in bbox) to maintain your cell count logic
    return (height_q, max_clipped, mean_crown, median_crown, int(v.size))


def shrink_bounds(left, bottom, right, top, shrink_fraction):
    """
    Shrink bounds inward by a fraction on each side.
    """
    if shrink_fraction <= 0:
        return left, bottom, right, top

    w = right - left
    h = top - bottom
    dx = w * shrink_fraction
    dy = h * shrink_fraction

    # keep valid
    new_left = left + dx
    new_right = right - dx
    new_bottom = bottom + dy
    new_top = top - dy

    if new_left >= new_right or new_bottom >= new_top:
        # fallback: don't shrink if bbox becomes invalid
        return left, bottom, right, top

    return new_left, new_bottom, new_right, new_top


# =========================
# LOAD DETECTIONS
# =========================
df = pd.read_excel(XLSX_IN)

required_cols = ["tl_lat","tl_lon","tr_lat","tr_lon","br_lat","br_lon","bl_lat","bl_lon"]
missing = [c for c in required_cols if c not in df.columns]
if missing:
    raise ValueError(f"Missing required columns in Excel: {missing}")

# =========================
# PROCESS CHM
# =========================
with rasterio.open(CHM_TIF) as src:
    nodata = src.nodata
    chm_crs = src.crs
    to_chm = Transformer.from_crs("EPSG:4326", chm_crs, always_xy=True)

    out_height_q = []
    out_max_clip = []
    out_mean_clip = []
    out_median_clip = []
    out_count = []

    out_center_sample = []  # CHM value at center point (debug)

    for idx, r in df.iterrows():
        # --- corners in lat/lon ---
        lats = np.array([r["tl_lat"], r["tr_lat"], r["br_lat"], r["bl_lat"]], dtype=float)
        lons = np.array([r["tl_lon"], r["tr_lon"], r["br_lon"], r["bl_lon"]], dtype=float)

        # lon/lat -> x/y in CHM CRS
        xs, ys = to_chm.transform(lons, lats)

        left, right = float(np.min(xs)), float(np.max(xs))
        bottom, top = float(np.min(ys)), float(np.max(ys))

        # optional shrink to avoid neighboring trees / edges
        left, bottom, right, top = shrink_bounds(left, bottom, right, top, SHRINK_FRACTION)

        # build window + clamp to raster
        win = from_bounds(left, bottom, right, top, transform=src.transform)
        win = win.round_offsets().round_lengths()

        # If window outside raster, skip safely
        if win.width <= 0 or win.height <= 0:
            out_height_q.append(np.nan)
            out_max_clip.append(np.nan)
            out_mean_clip.append(np.nan)
            out_median_clip.append(np.nan)
            out_count.append(0)
            out_center_sample.append(np.nan)
            continue

        data = src.read(1, window=win, masked=True)

        # mask nodata / invalid
        arr = np.ma.array(data, copy=False)
        arr = np.ma.masked_invalid(arr)
        if nodata is not None:
            arr = np.ma.masked_equal(arr, nodata)

        vals = arr.compressed()  # valid pixels only

        hq, mxc, meanc, medc, cnt = compute_tree_stats(
            vals,
            ignore_leq_zero=IGNORE_LEQ_ZERO,
            max_cap=MAX_CAP_METERS,
            q=HEIGHT_PERCENTILE
        )

        out_height_q.append(hq)
        out_max_clip.append(mxc)
        out_mean_clip.append(meanc)
        out_median_clip.append(medc)
        out_count.append(cnt)

        # Debug: sample at bbox center (using your center_lat/center_lon if present)
        if "center_lat" in df.columns and "center_lon" in df.columns:
            clat = float(r["center_lat"])
            clon = float(r["center_lon"])
        else:
            # fallback: average of corners
            clat = float(np.mean(lats))
            clon = float(np.mean(lons))

        cx, cy = to_chm.transform(clon, clat)
        center_val = list(src.sample([(cx, cy)]))[0][0]
        # treat nodata as NaN
        if nodata is not None and np.isfinite(center_val) and center_val == nodata:
            center_val = np.nan
        out_center_sample.append(float(center_val) if np.isfinite(center_val) else np.nan)

# =========================
# SAVE RESULTS
# =========================
df[f"tree_height_p{HEIGHT_PERCENTILE}"] = out_height_q
df["tree_height_max_clipped"] = out_max_clip
df["tree_height_mean_clipped"] = out_mean_clip
df["tree_height_median_clipped"] = out_median_clip
df["valid_cell_count"] = out_count
df["chm_center_value"] = out_center_sample

# Pick one column as final "tree_height"
df["tree_height"] = df[f"tree_height_p{HEIGHT_PERCENTILE}"]

df.to_excel(XLSX_OUT, index=False)

print("Saved:", XLSX_OUT)
print(df[["object_id","class","confidence","tree_height","tree_height_max_clipped","chm_center_value","valid_cell_count"]].head())
