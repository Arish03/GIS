import os
import numpy as np
import rasterio
from rasterio.warp import reproject, Resampling

DSM_TIF = "input/dsm.tif"
DTM_TIF = "input/dtm.tif"
OUT_DIR = "output"          # <-- your output folder name
OUT_CHM = os.path.join(OUT_DIR, "chm.tif")

# Choose resampling:
# - bilinear: smooth surfaces (good for elevation rasters)
# - nearest: preserves exact values (less common for DEM)
RESAMPLING = Resampling.bilinear

# Set to 0.0 if you want negative CHM clipped to 0 (often desired)
CLIP_NEGATIVE_TO_ZERO = False

os.makedirs(OUT_DIR, exist_ok=True)
with rasterio.open(DSM_TIF) as dsm_ds, rasterio.open(DTM_TIF) as dtm_ds:
    # We will produce CHM on the DSM grid (same shape/transform/crs)
    dsm = dsm_ds.read(1).astype("float32")

    # Prepare an array for DTM resampled onto DSM grid
    dtm_on_dsm = np.full((dsm_ds.height, dsm_ds.width), np.nan, dtype="float32")

    reproject(
        source=rasterio.band(dtm_ds, 1),
        destination=dtm_on_dsm,
        src_transform=dtm_ds.transform,
        src_crs=dtm_ds.crs,
        src_nodata=dtm_ds.nodata,
        dst_transform=dsm_ds.transform,
        dst_crs=dsm_ds.crs,
        dst_nodata=np.nan,
        resampling=RESAMPLING,
    )

    # Mask nodata from DSM and DTM
    dsm_nodata = dsm_ds.nodata
    if dsm_nodata is not None:
        dsm = np.where(dsm == dsm_nodata, np.nan, dsm)

    # CHM = DSM - DTM
    chm = dsm - dtm_on_dsm

    if CLIP_NEGATIVE_TO_ZERO:
        chm = np.where(np.isfinite(chm) & (chm < 0), 0.0, chm)

    # Write output GeoTIFF
    profile = dsm_ds.profile.copy()
    profile.update(
        dtype="float32",
        count=1,
        nodata=-3.4028235e+38,  # standard float32 nodata (similar to your earlier file)
        compress="deflate",
        predictor=2,
        tiled=True,
        blockxsize=256,
        blockysize=256,
    )

    nodata_out = profile["nodata"]
    chm_out = np.where(np.isfinite(chm), chm, nodata_out).astype("float32")

    with rasterio.open(OUT_CHM, "w", **profile) as out_ds:
        out_ds.write(chm_out, 1)

print("Wrote:", OUT_CHM)
