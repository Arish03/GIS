import os
import re
import glob
import json
import math
import shutil
import traceback
import subprocess
import logging
import time
from datetime import datetime

import cv2
import geopandas as gpd
import numpy as np
import rasterio
from rasterio.warp import reproject, Resampling
from rasterio.windows import Window, from_bounds
import pyogrio
from pyproj import Transformer
from shapely.geometry import mapping
from sqlalchemy.orm import Session
from ultralytics import YOLO

from app.celery_app import celery_app, redis_client
from app.database import SessionLocal
from app.models import Project, ProjectStatus, Tree, HealthStatus, DroneProcessingJob, DroneJobStatus
from app.config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)


def _find_shapefile(upload_dir: str, pattern: str) -> str | None:
    """Find a shapefile matching a pattern (case-insensitive)."""
    for f in os.listdir(upload_dir):
        if f.lower().endswith(".shp") and pattern.lower() in f.lower():
            return os.path.join(upload_dir, f)
    return None


def _find_tif(upload_dir: str, pattern: str) -> str | None:
    """Find a TIF file matching a pattern."""
    for f in os.listdir(upload_dir):
        if f.lower().endswith((".tif", ".tiff")) and pattern.lower() in f.lower():
            return os.path.join(upload_dir, f)
    return None


def _normalize_health(value) -> HealthStatus | None:
    """Normalize health classification values from shapefiles."""
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return None
    val = str(value).strip().lower()
    if val in ("healthy", "good", "1", "h"):
        return HealthStatus.HEALTHY
    elif val in ("moderate", "medium", "2", "m", "fair"):
        return HealthStatus.MODERATE
    elif val in ("poor", "bad", "3", "p", "unhealthy"):
        return HealthStatus.POOR
    return None


@celery_app.task(bind=True, name="process_project_files")
def process_project_files(self, project_id: str):
    """
    Main processing pipeline:
    1. Read & process shapefiles (boundary, trees, health)
    2. Merge tree height + health data
    3. Insert into PostGIS
    4. Generate XYZ tiles from rasters
    """
    db: Session = SessionLocal()
    try:
        project = db.query(Project).filter(Project.id == project_id).first()
        if not project:
            logger.error(f"Project {project_id} not found")
            return

        upload_dir = os.path.join(settings.UPLOAD_DIR, project_id)
        if not os.path.exists(upload_dir):
            raise FileNotFoundError(f"Upload directory not found: {upload_dir}")

        logger.info(f"Processing project {project_id} from {upload_dir}")
        logger.info(f"Files in upload dir: {os.listdir(upload_dir)}")

        # ── Step 1: Process Plantation Boundary ──────────────────
        boundary_shp = _find_shapefile(upload_dir, "boundary")
        if boundary_shp:
            try:
                logger.info(f"Processing boundary: {boundary_shp}")
                gdf_boundary = gpd.read_file(boundary_shp)
            except Exception as e:
                raise Exception(f"Failed to read Boundary shapefile. Ensure all parts (.dbf, .shx, .prj) are uploaded. Error: {e}")

            # Reproject to EPSG:4326 if needed
            if gdf_boundary.crs and gdf_boundary.crs.to_epsg() != 4326:
                gdf_boundary = gdf_boundary.to_crs(epsg=4326)

            # Store as GeoJSON
            boundary_geojson = gdf_boundary.to_json()
            project.boundary_geojson = boundary_geojson

            # Calculate area in hectares (reproject to a metric CRS)
            try:
                gdf_metric = gdf_boundary.to_crs(epsg=3857)
                area_m2 = gdf_metric.geometry.area.sum()
                project.area_hectares = round(area_m2 / 10000, 2)
            except Exception as e:
                logger.warning(f"Could not calculate area: {e}")

        # ── Step 2: Process Tree Height Data ─────────────────────
        tree_shp = _find_shapefile(upload_dir, "tree")
        if not tree_shp:
            tree_shp = _find_shapefile(upload_dir, "height")

        gdf_trees = None
        if tree_shp:
            try:
                logger.info(f"Processing trees: {tree_shp}")
                gdf_trees = gpd.read_file(tree_shp)
                if gdf_trees.crs and gdf_trees.crs.to_epsg() != 4326:
                    gdf_trees = gdf_trees.to_crs(epsg=4326)
            except Exception as e:
                raise Exception(f"Failed to read Tree Inventory shapefile. Ensure all parts (.dbf, .shx, .prj) are uploaded. Error: {e}")

        # ── Step 3: Process Health Data ──────────────────────────
        health_shp = _find_shapefile(upload_dir, "health")
        gdf_health = None
        if health_shp:
            try:
                logger.info(f"Processing health: {health_shp}")
                gdf_health = gpd.read_file(health_shp)
                if gdf_health.crs and gdf_health.crs.to_epsg() != 4326:
                    gdf_health = gdf_health.to_crs(epsg=4326)
            except Exception as e:
                raise Exception(f"Failed to read Health Data shapefile. Ensure all parts (.dbf, .shx, .prj) are uploaded. Error: {e}")

        # ── Step 4: Merge & Insert Trees ─────────────────────────
        if gdf_trees is not None:
            # Clean up old trees for this project
            db.query(Tree).filter(Tree.project_id == project_id).delete()

            # Try to find common ID column for merge
            tree_cols = [c.lower() for c in gdf_trees.columns]
            id_col_tree = None
            for candidate in ["id", "fid", "tree_id", "objectid"]:
                if candidate in tree_cols:
                    id_col_tree = gdf_trees.columns[tree_cols.index(candidate)]
                    break

            # Find height column
            height_col = None
            for candidate in ["tree_heigt", "tree_height", "height", "height_m", "z", "apex_height"]:
                if candidate in tree_cols:
                    height_col = gdf_trees.columns[tree_cols.index(candidate)]
                    break

            # Merge with health data if both exist
            merged = gdf_trees.copy()
            health_col_name = None

            if gdf_health is not None:
                health_cols = [c.lower() for c in gdf_health.columns]
                # Find ID column in health shapefile
                id_col_health = None
                for candidate in ["id", "fid", "tree_id", "objectid"]:
                    if candidate in health_cols:
                        id_col_health = gdf_health.columns[health_cols.index(candidate)]
                        break

                # Find health classification column
                for candidate in ["health", "classification", "class", "status", "gridcode", "health_score"]:
                    if candidate in health_cols:
                        health_col_name = gdf_health.columns[health_cols.index(candidate)]
                        break

                if id_col_tree and id_col_health and health_col_name:
                    # Merge on ID column
                    health_data = gdf_health[[id_col_health, health_col_name]].copy()
                    health_data = health_data.rename(columns={id_col_health: id_col_tree})
                    merged = merged.merge(health_data, on=id_col_tree, how="left")
                elif health_col_name:
                    # If no ID column, try spatial join
                    try:
                        merged = gpd.sjoin_nearest(gdf_trees, gdf_health[[health_col_name, "geometry"]], how="left")
                    except Exception:
                        pass

            # Insert trees into database
            tree_records = []
            for idx, row in merged.iterrows():
                geom = row.geometry
                lat = geom.y
                lon = geom.x

                height = None
                if height_col and height_col in merged.columns:
                    h = row[height_col]
                    if h is not None and not (isinstance(h, float) and np.isnan(h)):
                        height = round(float(h), 2)

                health = None
                if health_col_name and health_col_name in merged.columns:
                    health = _normalize_health(row[health_col_name])

                tree_index = idx + 1
                if id_col_tree and id_col_tree in merged.columns:
                    try:
                        tree_index = int(row[id_col_tree])
                    except (ValueError, TypeError):
                        tree_index = idx + 1

                tree = Tree(
                    project_id=project_id,
                    tree_index=tree_index,
                    latitude=lat,
                    longitude=lon,
                    height_m=height,
                    health_status=health,
                    geom=f"SRID=4326;POINT({lon} {lat})",
                )
                tree_records.append(tree)

            db.bulk_save_objects(tree_records)
            logger.info(f"Inserted {len(tree_records)} trees")

        # ── Step 5: Generate Raster Tiles ────────────────────────
        tiles_base = os.path.join(settings.TILES_DIR, project_id)
        os.makedirs(tiles_base, exist_ok=True)

        for raster_type in ["ortho", "dtm", "dsm"]:
            tif_file = _find_tif(upload_dir, raster_type)
            if tif_file:
                logger.info(f"Generating tiles for {raster_type}: {tif_file}")
                output_dir = os.path.join(tiles_base, raster_type)
                os.makedirs(output_dir, exist_ok=True)

                try:
                    # First reproject to Web Mercator if needed
                    reprojected = tif_file.replace(".tif", "_3857.tif")
                    subprocess.run(
                        [
                            "gdalwarp",
                            "-overwrite",
                            "-t_srs", "EPSG:3857",
                            "-r", "bilinear",
                            "-co", "COMPRESS=LZW",
                            "-dstalpha",
                            tif_file,
                            reprojected,
                        ],
                        check=True,
                        capture_output=True,
                        text=True,
                    )

                    # Pre-process for gdal2tiles (standard gdal2tiles requires Byte for PNG tiles)
                    # If it's not ortho (which is usually already 8-bit RGB), scale it
                    tile_input = reprojected
                    if raster_type in ["dtm", "dsm"]:
                        byte_vrt = reprojected.replace(".tif", ".vrt")
                        subprocess.run(
                            [
                                "gdal_translate",
                                "-of", "VRT",
                                "-ot", "Byte",
                                "-scale", # Auto-scale full range to 0-255
                                reprojected,
                                byte_vrt,
                            ],
                            check=True,
                            capture_output=True,
                            text=True,
                        )
                        tile_input = byte_vrt

                    # Generate tiles
                    subprocess.run(
                        [
                            "gdal2tiles.py",
                            "--xyz",
                            "-z", "2-22",
                            "-w", "none",
                            "-r", "bilinear",
                            "--processes=2",
                            tile_input,
                            output_dir,
                        ],
                        check=True,
                        capture_output=True,
                        text=True,
                    )

                    # Cleanup reprojected file
                    if os.path.exists(reprojected):
                        os.remove(reprojected)

                    logger.info(f"Tiles generated for {raster_type}")
                except subprocess.CalledProcessError as e:
                    logger.error(f"Tile generation failed for {raster_type}: {e.stderr}")
                except Exception as e:
                    logger.error(f"Error processing {raster_type}: {e}")

        # ── Done ─────────────────────────────────────────────────
        project.status = ProjectStatus.REVIEW_PENDING
        project.processing_error = None
        db.commit()
        logger.info(f"Project {project_id} processing complete")

    except Exception as e:
        logger.error(f"Processing failed for {project_id}: {traceback.format_exc()}")
        try:
            project = db.query(Project).filter(Project.id == project_id).first()
            if project:
                project.status = ProjectStatus.ERROR
                project.processing_error = str(e)
                db.commit()
        except Exception:
            pass
    finally:
        db.close()


# ── Drone Photogrammetry Pipeline ────────────────────────────

# Strict, non-negotiable ODM parameters for precision forestry
ODM_OPTIONS = {
    "dsm": True,
    "dtm": True,
    "orthophoto-resolution": 2.0,
    "dem-resolution": 8.0,
    "camera-lens": "brown",
    "smrf-window": 3,
    "smrf-threshold": 2,
    "fast-orthophoto": False,
}


def _update_drone_progress(project_id: str, status: str, progress: int, message: str = None, error: str = None):
    """Write ephemeral progress to Redis for fast frontend polling."""
    redis_key = f"drone_progress:{project_id}"
    payload = {"status": status, "progress": progress}
    if message:
        payload["message"] = message
    if error:
        payload["error"] = error
    redis_client.setex(redis_key, 3600, json.dumps(payload))


def _update_drone_job_db(db: Session, project_id: str, status: DroneJobStatus, progress: int,
                         error_message: str = None, nodeodm_uuid: str = None):
    """Persist job state to Postgres."""
    drone_job = db.query(DroneProcessingJob).filter(
        DroneProcessingJob.project_id == project_id
    ).first()
    if drone_job:
        drone_job.status = status
        drone_job.progress = progress
        if error_message is not None:
            drone_job.error_message = error_message
        if nodeodm_uuid is not None:
            drone_job.nodeodm_task_uuid = nodeodm_uuid
        if status in (DroneJobStatus.COMPLETED, DroneJobStatus.FAILED):
            drone_job.completed_at = datetime.utcnow()
        db.commit()


def _generate_raster_tiles(tif_file: str, raster_type: str, tiles_base: str):
    """Generate XYZ tiles from a GeoTIFF. Reuses the same logic as process_project_files."""
    output_dir = os.path.join(tiles_base, raster_type)
    os.makedirs(output_dir, exist_ok=True)

    # Reproject to Web Mercator
    reprojected = tif_file.replace(".tif", "_3857.tif")
    subprocess.run(
        [
            "gdalwarp", "-overwrite",
            "-t_srs", "EPSG:3857",
            "-r", "bilinear",
            "-co", "COMPRESS=LZW",
            "-dstalpha",
            tif_file, reprojected,
        ],
        check=True, capture_output=True, text=True,
    )

    tile_input = reprojected
    if raster_type in ["dtm", "dsm"]:
        byte_vrt = reprojected.replace(".tif", ".vrt")
        subprocess.run(
            [
                "gdal_translate", "-of", "VRT", "-ot", "Byte", "-scale",
                reprojected, byte_vrt,
            ],
            check=True, capture_output=True, text=True,
        )
        tile_input = byte_vrt

    subprocess.run(
        [
            "gdal2tiles.py", "--xyz",
            "-z", "2-22", "-w", "none",
            "-r", "bilinear", "--processes=2",
            tile_input, output_dir,
        ],
        check=True, capture_output=True, text=True,
    )

    # Cleanup temp files
    if os.path.exists(reprojected):
        os.remove(reprojected)
    vrt_path = reprojected.replace(".tif", ".vrt")
    if os.path.exists(vrt_path):
        os.remove(vrt_path)

    logger.info(f"Tiles generated for {raster_type}")


# ── Tree Detection Pipeline Helpers ──────────────────────────

def _generate_chm(dsm_path: str, dtm_path: str, output_path: str) -> str:
    """Generate Canopy Height Model: CHM = DSM - DTM."""
    with rasterio.open(dsm_path) as dsm_ds, rasterio.open(dtm_path) as dtm_ds:
        dsm = dsm_ds.read(1).astype("float32")

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
            resampling=Resampling.bilinear,
        )

        dsm_nodata = dsm_ds.nodata
        if dsm_nodata is not None:
            dsm = np.where(dsm == dsm_nodata, np.nan, dsm)

        chm = dsm - dtm_on_dsm
        chm = np.where(np.isfinite(chm) & (chm < 0), 0.0, chm)

        profile = dsm_ds.profile.copy()
        nodata_out = np.float32(-9999.0)
        profile.update(
            dtype="float32", count=1, nodata=nodata_out,
            compress="deflate", predictor=2, tiled=True,
            blockxsize=256, blockysize=256,
        )
        chm_out = np.where(np.isfinite(chm), chm, nodata_out).astype("float32")

        with rasterio.open(output_path, "w", **profile) as out_ds:
            out_ds.write(chm_out, 1)

    logger.info(f"CHM generated: {output_path}")
    return output_path


def _split_ortho(ortho_path: str, output_dir: str, tile_size: int = 2048, overlap: float = 0.2) -> list:
    """Split a large GeoTIFF into overlapping tiles for YOLO inference."""
    os.makedirs(output_dir, exist_ok=True)
    stride = int(tile_size * (1 - overlap))
    base_name = os.path.splitext(os.path.basename(ortho_path))[0]
    tile_paths = []

    with rasterio.open(ortho_path) as src:
        meta = src.meta.copy()
        for row_off in range(0, src.height, stride):
            for col_off in range(0, src.width, stride):
                width = min(tile_size, src.width - col_off)
                height = min(tile_size, src.height - row_off)
                if width <= 0 or height <= 0:
                    continue

                window = Window(col_off, row_off, width, height)
                tile_data = src.read(window=window)
                new_transform = src.window_transform(window)
                meta.update(driver="GTiff", height=height, width=width, transform=new_transform)

                out_filename = f"{base_name}_tile_{row_off}_{col_off}.tif"
                out_filepath = os.path.join(output_dir, out_filename)
                with rasterio.open(out_filepath, "w", **meta) as dest:
                    dest.write(tile_data)
                tile_paths.append(out_filepath)

    logger.info(f"Split ortho into {len(tile_paths)} tiles")
    return tile_paths


def _read_geotiff_as_bgr(path: str):
    """Read a GeoTIFF and scale robustly to 8-bit BGR for YOLO."""
    with rasterio.open(path) as src:
        transform = src.transform
        crs = src.crs
        count = src.count

        if count == 1:
            band = src.read(1).astype(np.float32)
            lo, hi = np.nanpercentile(band, (1, 99))
            if not np.isfinite(lo):
                lo = np.nanmin(band)
            if not np.isfinite(hi):
                hi = np.nanmax(band)
            if hi <= lo:
                hi = lo + 1.0
            band8 = np.clip((band - lo) * 255.0 / (hi - lo), 0, 255).astype(np.uint8)
            return cv2.cvtColor(band8, cv2.COLOR_GRAY2BGR), transform, crs

        rgb = src.read([1, 2, 3]).astype(np.float32)
        out = np.zeros_like(rgb, dtype=np.uint8)
        for i in range(3):
            band = rgb[i]
            lo, hi = np.nanpercentile(band, (1, 99))
            if not np.isfinite(lo):
                lo = np.nanmin(band)
            if not np.isfinite(hi):
                hi = np.nanmax(band)
            if hi <= lo:
                hi = lo + 1.0
            out[i] = np.clip((band - lo) * 255.0 / (hi - lo), 0, 255).astype(np.uint8)

        img_rgb = np.transpose(out, (1, 2, 0))
        return cv2.cvtColor(img_rgb, cv2.COLOR_RGB2BGR), transform, crs


def _custom_nms_keep_largest(boxes, scores, iou_thresh=0.5):
    """Custom NMS prioritizing larger bounding boxes using IoS + IoU."""
    if len(boxes) == 0:
        return []

    boxes = np.array(boxes)
    scores = np.array(scores)
    areas = (boxes[:, 2] - boxes[:, 0]) * (boxes[:, 3] - boxes[:, 1])
    order = areas.argsort()[::-1]

    keep = []
    while order.size > 0:
        i = order[0]
        keep.append(i)
        if order.size == 1:
            break

        xx1 = np.maximum(boxes[i, 0], boxes[order[1:], 0])
        yy1 = np.maximum(boxes[i, 1], boxes[order[1:], 1])
        xx2 = np.minimum(boxes[i, 2], boxes[order[1:], 2])
        yy2 = np.minimum(boxes[i, 3], boxes[order[1:], 3])

        w = np.maximum(0.0, xx2 - xx1)
        h = np.maximum(0.0, yy2 - yy1)
        inter = w * h

        smaller_areas = areas[order[1:]]
        ios = inter / smaller_areas
        union = areas[i] + smaller_areas - inter
        iou = inter / union
        overlap = np.maximum(ios, iou)

        inds = np.where(overlap <= iou_thresh)[0]
        order = order[inds + 1]

    return keep


def _px_to_lonlat(px_x, px_y, transform, transformer):
    """Convert pixel coordinate to WGS84 lat/lon."""
    if transform is None or transformer is None:
        return None, None
    map_x, map_y = rasterio.transform.xy(transform, px_y, px_x, offset="center")
    lon, lat = transformer.transform(map_x, map_y)
    return lat, lon


def _detect_trees(tiles_dir: str, model_path: str, conf_thresh: float = 0.4,
                  nms_thresh: float = 0.5) -> list:
    """Run YOLO on tiled GeoTIFFs with custom NMS, return georef detections."""
    model = YOLO(model_path, task="detect")

    tile_files = sorted(glob.glob(os.path.join(tiles_dir, "*.tif")))
    if not tile_files:
        logger.warning(f"No tiles found in {tiles_dir}")
        return []

    all_global_boxes = []
    all_scores = []
    all_metadata = []

    for filepath in tile_files:
        filename = os.path.basename(filepath)
        match = re.search(r'_tile_(\d+)_(\d+)\.tif$', filename, re.IGNORECASE)
        row_off = int(match.group(1)) if match else 0
        col_off = int(match.group(2)) if match else 0

        try:
            frame, transform, crs = _read_geotiff_as_bgr(filepath)
        except Exception as e:
            logger.warning(f"Skipping tile {filename}: {e}")
            continue

        transformer = None
        if crs is not None:
            transformer = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)

        results = model(frame, verbose=False)
        boxes = results[0].boxes

        for i in range(len(boxes)):
            conf = float(boxes[i].conf.item())
            if conf < conf_thresh:
                continue

            xyxy = boxes[i].xyxy.cpu().numpy().squeeze()
            if xyxy.ndim == 0:
                continue
            if xyxy.ndim == 1:
                xmin, ymin, xmax, ymax = xyxy
            else:
                xmin, ymin, xmax, ymax = xyxy[0]

            g_xmin = int(xmin + col_off)
            g_ymin = int(ymin + row_off)
            g_xmax = int(xmax + col_off)
            g_ymax = int(ymax + row_off)

            c_x, c_y = (xmin + xmax) / 2.0, (ymin + ymax) / 2.0
            center_lat, center_lon = _px_to_lonlat(c_x, c_y, transform, transformer)
            tl_lat, tl_lon = _px_to_lonlat(xmin, ymin, transform, transformer)
            tr_lat, tr_lon = _px_to_lonlat(xmax, ymin, transform, transformer)
            br_lat, br_lon = _px_to_lonlat(xmax, ymax, transform, transformer)
            bl_lat, bl_lon = _px_to_lonlat(xmin, ymax, transform, transformer)

            all_global_boxes.append([g_xmin, g_ymin, g_xmax, g_ymax])
            all_scores.append(conf)
            all_metadata.append({
                "confidence": conf,
                "center_lat": center_lat,
                "center_lon": center_lon,
                "xmin_px": g_xmin, "ymin_px": g_ymin,
                "xmax_px": g_xmax, "ymax_px": g_ymax,
                "tl_lat": tl_lat, "tl_lon": tl_lon,
                "tr_lat": tr_lat, "tr_lon": tr_lon,
                "br_lat": br_lat, "br_lon": br_lon,
                "bl_lat": bl_lat, "bl_lon": bl_lon,
            })

    if not all_global_boxes:
        return []

    logger.info(f"Raw detections: {len(all_global_boxes)}, running NMS...")
    kept = _custom_nms_keep_largest(all_global_boxes, all_scores, iou_thresh=nms_thresh)

    detections = []
    for idx in kept:
        det = all_metadata[idx].copy()
        det["object_id"] = len(detections) + 1
        detections.append(det)

    logger.info(f"Final tree count after NMS: {len(detections)}")
    return detections


def _compute_tree_height(vals_1d: np.ndarray, max_cap: float = 10.0, q: int = 98):
    """Compute tree height from CHM pixel values using p98 + crown isolation."""
    v = vals_1d.astype(np.float64)
    v = v[np.isfinite(v)]
    v = v[v > 0]
    if max_cap is not None:
        v = v[v < max_cap]
    if v.size == 0:
        return None

    height_q = float(np.percentile(v, q))
    return round(height_q, 2)


def _extract_heights(detections: list, chm_path: str, shrink_fraction: float = 0.50) -> list:
    """Extract tree heights from CHM for each detection bbox."""
    with rasterio.open(chm_path) as src:
        nodata = src.nodata
        chm_crs = src.crs
        to_chm = Transformer.from_crs("EPSG:4326", chm_crs, always_xy=True)

        for det in detections:
            lats = [det["tl_lat"], det["tr_lat"], det["br_lat"], det["bl_lat"]]
            lons = [det["tl_lon"], det["tr_lon"], det["br_lon"], det["bl_lon"]]

            if any(v is None for v in lats + lons):
                det["height_m"] = None
                continue

            xs, ys = to_chm.transform(lons, lats)
            left, right = float(min(xs)), float(max(xs))
            bottom, top = float(min(ys)), float(max(ys))

            if shrink_fraction > 0:
                w, h = right - left, top - bottom
                dx, dy = w * shrink_fraction, h * shrink_fraction
                new_left, new_right = left + dx, right - dx
                new_bottom, new_top = bottom + dy, top - dy
                if new_left < new_right and new_bottom < new_top:
                    left, right, bottom, top = new_left, new_right, new_bottom, new_top

            try:
                win = from_bounds(left, bottom, right, top, transform=src.transform)
                win = win.round_offsets().round_lengths()
                if win.width <= 0 or win.height <= 0:
                    det["height_m"] = None
                    continue

                data = src.read(1, window=win, masked=True)
                arr = np.ma.masked_invalid(data)
                if nodata is not None:
                    arr = np.ma.masked_equal(arr, nodata)
                vals = arr.compressed()

                det["height_m"] = _compute_tree_height(vals)
            except Exception:
                det["height_m"] = None

    return detections


def _classify_health_gcc(detections: list, ortho_path: str, shrink: float = 0.3) -> list:
    """
    Classify tree health using multiple vegetation indices from RGB ortho.

    Computes VARI (primary), GCC, and GLI per tree bbox, then classifies
    based on VARI thresholds with GCC as a secondary signal.
    Also stores the numeric VARI value on each detection for analytics.
    """
    with rasterio.open(ortho_path) as src:
        ortho_crs = src.crs
        to_ortho = Transformer.from_crs("EPSG:4326", ortho_crs, always_xy=True)

        for det in detections:
            lats = [det["tl_lat"], det["tr_lat"], det["br_lat"], det["bl_lat"]]
            lons = [det["tl_lon"], det["tr_lon"], det["br_lon"], det["bl_lon"]]

            if any(v is None for v in lats + lons):
                det["health_status"] = None
                det["vari_mean"] = None
                continue

            xs, ys = to_ortho.transform(lons, lats)
            left, right = float(min(xs)), float(max(xs))
            bottom, top = float(min(ys)), float(max(ys))

            if shrink > 0:
                w, h = right - left, top - bottom
                dx, dy = w * shrink, h * shrink
                nl, nr = left + dx, right - dx
                nb, nt = bottom + dy, top - dy
                if nl < nr and nb < nt:
                    left, right, bottom, top = nl, nr, nb, nt

            try:
                win = from_bounds(left, bottom, right, top, transform=src.transform)
                win = win.round_offsets().round_lengths()
                if win.width <= 0 or win.height <= 0:
                    det["health_status"] = None
                    det["vari_mean"] = None
                    continue

                r = src.read(1, window=win).astype(np.float64) / 255.0
                g = src.read(2, window=win).astype(np.float64) / 255.0
                b = src.read(3, window=win).astype(np.float64) / 255.0

                total = r + g + b
                mask = total > 0
                if not np.any(mask):
                    det["health_status"] = None
                    det["vari_mean"] = None
                    continue

                # VARI = (G - R) / (G + R - B)
                vari_den = g + r - b
                with np.errstate(divide='ignore', invalid='ignore'):
                    vari = np.where((mask) & (vari_den != 0), (g - r) / vari_den, np.nan)
                vari_mean = float(np.nanmean(vari))

                # GCC = G / (R + G + B)
                gcc = np.where(mask, g / total, np.nan)
                gcc_mean = float(np.nanmean(gcc))

                det["vari_mean"] = round(vari_mean, 4)

                # Classification using VARI as primary, GCC as secondary
                # VARI ranges: >0.1 healthy, 0.0-0.1 moderate, <0.0 poor
                # GCC ranges: >0.38 healthy, 0.33-0.38 moderate, <0.33 poor
                if vari_mean > 0.1 and gcc_mean > 0.35:
                    det["health_status"] = HealthStatus.HEALTHY
                elif vari_mean > 0.0 and gcc_mean >= 0.30:
                    det["health_status"] = HealthStatus.MODERATE
                else:
                    det["health_status"] = HealthStatus.POOR
            except Exception:
                det["health_status"] = None
                det["vari_mean"] = None

    return detections


def compute_single_tree(project_id: str, tl_lat: float, tl_lon: float,
                        tr_lat: float, tr_lon: float,
                        br_lat: float, br_lon: float,
                        bl_lat: float, bl_lon: float) -> dict:
    """Compute height and health for a single manually-drawn tree bbox."""
    output_dir = os.path.join(settings.UPLOAD_DIR, str(project_id))
    ortho_path = os.path.join(output_dir, "ortho.tif")
    chm_path = os.path.join(output_dir, "chm.tif")

    det = {
        "tl_lat": tl_lat, "tl_lon": tl_lon,
        "tr_lat": tr_lat, "tr_lon": tr_lon,
        "br_lat": br_lat, "br_lon": br_lon,
        "bl_lat": bl_lat, "bl_lon": bl_lon,
        "center_lat": (tl_lat + br_lat) / 2,
        "center_lon": (tl_lon + br_lon) / 2,
        "confidence": None,
        "height_m": None,
        "health_status": None,
    }

    # Compute pixel coords from ortho
    if os.path.exists(ortho_path):
        with rasterio.open(ortho_path) as src:
            ortho_crs = src.crs
            to_ortho = Transformer.from_crs("EPSG:4326", ortho_crs, always_xy=True)
            lons = [tl_lon, tr_lon, br_lon, bl_lon]
            lats = [tl_lat, tr_lat, br_lat, bl_lat]
            xs, ys = to_ortho.transform(lons, lats)
            rows, cols = rasterio.transform.rowcol(src.transform, xs, ys)
            det["xmin_px"] = int(min(cols))
            det["ymin_px"] = int(min(rows))
            det["xmax_px"] = int(max(cols))
            det["ymax_px"] = int(max(rows))

    # Extract height from CHM
    if os.path.exists(chm_path):
        _extract_heights([det], chm_path)

    # Classify health from ortho
    if os.path.exists(ortho_path):
        _classify_health_gcc([det], ortho_path)

    return det


@celery_app.task(bind=True, name="process_drone_flight", max_retries=0)
def process_drone_flight(self, project_id: str):
    """
    End-to-end drone photogrammetry pipeline:
    1. Connect to NodeODM
    2. Upload staged images → create processing task
    3. Monitor progress via status_callback
    4. Download results (orthophoto, DTM, DSM)
    5. Cleanup raw images
    6. Generate XYZ tiles
    7. Finalize project status → READY
    """
    from pyodm import Node
    from pyodm.exceptions import NodeConnectionError, NodeResponseError

    db: Session = SessionLocal()
    staging_dir = os.path.join(settings.UPLOAD_DIR, project_id, "drone-images")

    try:
        project = db.query(Project).filter(Project.id == project_id).first()
        if not project:
            logger.error(f"Drone: Project {project_id} not found")
            return

        _update_drone_progress(project_id, "processing", 0, "Connecting to NodeODM...")
        _update_drone_job_db(db, project_id, DroneJobStatus.PROCESSING, 0)

        # ── Step 1: Connect to NodeODM ───────────────────────────
        node = None
        for attempt in range(3):
            try:
                node = Node.from_url(settings.NODEODM_URL)
                info = node.info()
                logger.info(f"Connected to NodeODM: {info.version}")
                break
            except (NodeConnectionError, Exception) as e:
                if attempt == 2:
                    raise ConnectionError(f"Failed to reach NodeODM after 3 attempts: {e}")
                wait_time = 5 * (2 ** attempt)
                logger.warning(f"NodeODM connection attempt {attempt + 1} failed, retrying in {wait_time}s...")
                time.sleep(wait_time)

        # ── Step 2: Collect staged images ────────────────────────
        image_paths = sorted(
            glob.glob(os.path.join(staging_dir, "*.jpg"))
            + glob.glob(os.path.join(staging_dir, "*.jpeg"))
            + glob.glob(os.path.join(staging_dir, "*.JPG"))
            + glob.glob(os.path.join(staging_dir, "*.JPEG"))
        )
        if len(image_paths) < 2:
            raise ValueError(f"Not enough images for photogrammetry ({len(image_paths)} found, minimum 2)")

        logger.info(f"Drone: Sending {len(image_paths)} images to NodeODM for project {project_id}")
        _update_drone_progress(project_id, "processing", 2, f"Uploading {len(image_paths)} images to NodeODM...")

        # ── Step 3: Create NodeODM task ──────────────────────────
        task = node.create_task(
            image_paths,
            options=ODM_OPTIONS,
            name=f"plantation-{project_id[:8]}",
        )
        task_uuid = task.info().uuid
        logger.info(f"NodeODM task created: {task_uuid}")
        _update_drone_job_db(db, project_id, DroneJobStatus.PROCESSING, 5, nodeodm_uuid=task_uuid)
        _update_drone_progress(project_id, "processing", 5, "NodeODM task created. Processing images...")

        # ── Step 4: Monitor progress ─────────────────────────────
        last_db_progress = 0

        def on_status_update(info):
            nonlocal last_db_progress
            progress_val = info.progress
            # Scale NodeODM 0-100 to our 5-80 range (reserve 80-100 for download+tiling)
            scaled = 5 + int(progress_val * 0.75)
            status_msg = f"Processing: {progress_val:.0f}% — {info.status.name if hasattr(info.status, 'name') else info.status}"
            _update_drone_progress(project_id, "processing", scaled, status_msg)

            # Persist to DB every 5%
            if scaled - last_db_progress >= 5:
                try:
                    _update_drone_job_db(db, project_id, DroneJobStatus.PROCESSING, scaled)
                    last_db_progress = scaled
                except Exception:
                    pass

        task.wait_for_completion(status_callback=on_status_update)

        # Verify task completed successfully
        task_info = task.info()
        if task_info.status.name != "COMPLETED":
            raise RuntimeError(
                f"NodeODM task ended with status {task_info.status.name}: "
                f"{getattr(task_info, 'last_error', 'Unknown error')}"
            )

        logger.info(f"NodeODM processing complete for {project_id}")

        # ── Step 5: Download results ─────────────────────────────
        _update_drone_progress(project_id, "downloading", 82, "Downloading processed results...")
        _update_drone_job_db(db, project_id, DroneJobStatus.DOWNLOADING, 82)

        output_dir = os.path.join(settings.UPLOAD_DIR, project_id)
        assets_dir = os.path.join(output_dir, "odm_output")
        os.makedirs(assets_dir, exist_ok=True)

        task.download_assets(assets_dir)
        logger.info(f"Assets downloaded to {assets_dir}")

        # Map NodeODM output paths → standardized names
        result_map = {
            "ortho": os.path.join(assets_dir, "odm_orthophoto", "odm_orthophoto.tif"),
            "dsm": os.path.join(assets_dir, "odm_dem", "dsm.tif"),
            "dtm": os.path.join(assets_dir, "odm_dem", "dtm.tif"),
        }

        for raster_type, src_path in result_map.items():
            dest_path = os.path.join(output_dir, f"{raster_type}.tif")
            if os.path.exists(src_path):
                shutil.move(src_path, dest_path)
                logger.info(f"Moved {raster_type}: {src_path} → {dest_path}")
            else:
                logger.warning(f"Expected output not found: {src_path}")

        # ── Step 6: Cleanup ──────────────────────────────────────
        _update_drone_progress(project_id, "tiling", 87, "Cleaning up temporary files...")

        # Remove raw drone images
        if os.path.exists(staging_dir):
            shutil.rmtree(staging_dir)
            logger.info(f"Cleaned staging directory: {staging_dir}")

        # Remove NodeODM output directory
        if os.path.exists(assets_dir):
            shutil.rmtree(assets_dir)

        # ── Step 7: Generate XYZ tiles ───────────────────────────
        _update_drone_progress(project_id, "tiling", 88, "Generating map tiles...")
        _update_drone_job_db(db, project_id, DroneJobStatus.TILING, 88)

        tiles_base = os.path.join(settings.TILES_DIR, project_id)
        os.makedirs(tiles_base, exist_ok=True)

        tile_types = ["ortho", "dtm", "dsm"]
        for i, raster_type in enumerate(tile_types):
            tif_path = os.path.join(output_dir, f"{raster_type}.tif")
            if os.path.exists(tif_path):
                progress_pct = 88 + int((i + 1) / len(tile_types) * 10)
                _update_drone_progress(
                    project_id, "tiling", progress_pct,
                    f"Generating {raster_type.upper()} tiles ({i + 1}/{len(tile_types)})..."
                )
                try:
                    _generate_raster_tiles(tif_path, raster_type, tiles_base)
                except subprocess.CalledProcessError as e:
                    logger.error(f"Tile generation failed for {raster_type}: {e.stderr}")
                except Exception as e:
                    logger.error(f"Error tiling {raster_type}: {e}")
            else:
                logger.warning(f"No {raster_type}.tif found, skipping tile generation")

        # ── Step 8: Generate CHM ────────────────────────────────
        _update_drone_progress(project_id, "detecting", 90, "Generating Canopy Height Model (CHM)...")
        _update_drone_job_db(db, project_id, DroneJobStatus.DETECTING, 90)

        dsm_path = os.path.join(output_dir, "dsm.tif")
        dtm_path = os.path.join(output_dir, "dtm.tif")
        chm_path = os.path.join(output_dir, "chm.tif")
        ortho_path = os.path.join(output_dir, "ortho.tif")

        if os.path.exists(dsm_path) and os.path.exists(dtm_path):
            _generate_chm(dsm_path, dtm_path, chm_path)
        else:
            logger.warning("DSM or DTM not found, skipping CHM generation")

        # ── Step 9: Split ortho into tiles for YOLO ──────────────
        _update_drone_progress(project_id, "detecting", 91, "Splitting orthomosaic into tiles...")

        ortho_tiles_dir = os.path.join(output_dir, "ortho_tiles")
        if os.path.exists(ortho_path):
            _split_ortho(ortho_path, ortho_tiles_dir, tile_size=2048, overlap=0.2)
        else:
            logger.warning("Ortho not found, skipping tree detection")

        # ── Step 10: Run YOLO tree detection ─────────────────────
        detections = []
        if os.path.exists(ortho_tiles_dir) and os.listdir(ortho_tiles_dir):
            _update_drone_progress(project_id, "detecting", 92, "Running tree detection (YOLOv9)...")
            detections = _detect_trees(
                ortho_tiles_dir, settings.YOLO_MODEL_PATH,
                conf_thresh=0.4, nms_thresh=0.5
            )
            _update_drone_progress(project_id, "detecting", 96,
                                   f"Detected {len(detections)} trees. Extracting heights...")

        # ── Step 11: Extract tree heights from CHM ───────────────
        if detections and os.path.exists(chm_path):
            _update_drone_progress(project_id, "computing_heights", 97, "Computing tree heights from CHM...")
            _update_drone_job_db(db, project_id, DroneJobStatus.COMPUTING_HEIGHTS, 97)
            detections = _extract_heights(detections, chm_path)

        # ── Step 12: Classify tree health via GCC ────────────────
        if detections and os.path.exists(ortho_path):
            _update_drone_progress(project_id, "computing_heights", 98, "Classifying tree health (GCC)...")
            detections = _classify_health_gcc(detections, ortho_path)

        # ── Step 13: Insert trees into database ──────────────────
        if detections:
            _update_drone_progress(project_id, "computing_heights", 99,
                                   f"Saving {len(detections)} trees to database...")

            # Clear any existing trees for this project
            db.query(Tree).filter(Tree.project_id == project_id).delete()

            tree_records = []
            for idx, det in enumerate(detections):
                lat = det.get("center_lat")
                lon = det.get("center_lon")
                if lat is None or lon is None:
                    continue

                health = det.get("health_status")

                tree = Tree(
                    project_id=project_id,
                    tree_index=idx + 1,
                    latitude=lat,
                    longitude=lon,
                    height_m=det.get("height_m"),
                    health_status=health,
                    confidence=det.get("confidence"),
                    detection_source="auto",
                    xmin_px=det.get("xmin_px"),
                    ymin_px=det.get("ymin_px"),
                    xmax_px=det.get("xmax_px"),
                    ymax_px=det.get("ymax_px"),
                    bbox_tl_lat=det.get("tl_lat"),
                    bbox_tl_lon=det.get("tl_lon"),
                    bbox_tr_lat=det.get("tr_lat"),
                    bbox_tr_lon=det.get("tr_lon"),
                    bbox_br_lat=det.get("br_lat"),
                    bbox_br_lon=det.get("br_lon"),
                    bbox_bl_lat=det.get("bl_lat"),
                    bbox_bl_lon=det.get("bl_lon"),
                    geom=f"SRID=4326;POINT({lon} {lat})",
                )
                tree_records.append(tree)

            db.bulk_save_objects(tree_records)
            logger.info(f"Inserted {len(tree_records)} auto-detected trees")

        # ── Step 14: Cleanup ortho tiles ─────────────────────────
        if os.path.exists(ortho_tiles_dir):
            shutil.rmtree(ortho_tiles_dir)

        # ── Step 15: Finalize ────────────────────────────────────
        project.status = ProjectStatus.REVIEW_PENDING
        project.processing_error = None
        _update_drone_job_db(db, project_id, DroneJobStatus.COMPLETED, 100)
        _update_drone_progress(project_id, "completed", 100, "Processing complete!")
        db.commit()
        logger.info(f"Drone pipeline complete for project {project_id}")

    except Exception as e:
        logger.error(f"Drone pipeline failed for {project_id}: {traceback.format_exc()}")
        error_msg = str(e)
        try:
            project = db.query(Project).filter(Project.id == project_id).first()
            if project:
                project.status = ProjectStatus.ERROR
                project.processing_error = error_msg
            _update_drone_job_db(db, project_id, DroneJobStatus.FAILED, 0, error_message=error_msg)
            _update_drone_progress(project_id, "failed", 0, error=error_msg)
            db.commit()
        except Exception:
            logger.error(f"Failed to update error state: {traceback.format_exc()}")

        # Attempt cleanup of staging dir even on failure
        try:
            if os.path.exists(staging_dir):
                shutil.rmtree(staging_dir)
        except Exception:
            pass
    finally:
        db.close()
