"""
One-time recovery script: Re-runs ML detection pipeline (steps 8-15) for a project
whose photogrammetry completed but detection failed due to missing DB enum/column.
Run inside celery container: docker exec plantation-celery python recover_pipeline.py <project_id>
"""
import sys
import os

# Ensure app module is importable
sys.path.insert(0, "/app")

from app.database import SessionLocal
from app.models import Project, ProjectStatus, Tree, HealthStatus, DroneProcessingJob, DroneJobStatus
from app.config import get_settings
from app.tasks import (
    _generate_chm, _split_ortho, _detect_trees,
    _extract_heights, _classify_health_gcc,
    _update_drone_progress, _update_drone_job_db,
)
import shutil
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

settings = get_settings()


def recover(project_id: str):
    db = SessionLocal()
    try:
        project = db.query(Project).filter(Project.id == project_id).first()
        if not project:
            logger.error(f"Project {project_id} not found")
            return

        output_dir = os.path.join(settings.UPLOAD_DIR, project_id)
        dsm_path = os.path.join(output_dir, "dsm.tif")
        dtm_path = os.path.join(output_dir, "dtm.tif")
        chm_path = os.path.join(output_dir, "chm.tif")
        ortho_path = os.path.join(output_dir, "ortho.tif")

        # Step 8: Generate CHM
        logger.info("Step 8: Generating CHM...")
        _update_drone_progress(project_id, "detecting", 90, "Generating Canopy Height Model (CHM)...")
        _update_drone_job_db(db, project_id, DroneJobStatus.DETECTING, 90)

        if os.path.exists(dsm_path) and os.path.exists(dtm_path):
            _generate_chm(dsm_path, dtm_path, chm_path)
            logger.info(f"CHM generated: {chm_path}")
        else:
            logger.warning("DSM or DTM not found, skipping CHM generation")

        # Step 9: Split ortho into tiles for YOLO
        logger.info("Step 9: Splitting orthomosaic...")
        _update_drone_progress(project_id, "detecting", 91, "Splitting orthomosaic into tiles...")
        ortho_tiles_dir = os.path.join(output_dir, "ortho_tiles")
        if os.path.exists(ortho_path):
            _split_ortho(ortho_path, ortho_tiles_dir, tile_size=2048, overlap=0.2)
        else:
            logger.warning("Ortho not found, skipping detection")

        # Step 10: Run YOLO tree detection
        detections = []
        if os.path.exists(ortho_tiles_dir) and os.listdir(ortho_tiles_dir):
            logger.info("Step 10: Running YOLO detection...")
            _update_drone_progress(project_id, "detecting", 92, "Running tree detection (YOLOv9)...")
            detections = _detect_trees(
                ortho_tiles_dir, settings.YOLO_MODEL_PATH,
                conf_thresh=0.4, nms_thresh=0.5
            )
            logger.info(f"Detected {len(detections)} trees")
            _update_drone_progress(project_id, "detecting", 96,
                                   f"Detected {len(detections)} trees. Extracting heights...")

        # Step 11: Extract tree heights from CHM
        if detections and os.path.exists(chm_path):
            logger.info("Step 11: Extracting heights...")
            _update_drone_progress(project_id, "computing_heights", 97, "Computing tree heights from CHM...")
            _update_drone_job_db(db, project_id, DroneJobStatus.COMPUTING_HEIGHTS, 97)
            detections = _extract_heights(detections, chm_path)

        # Step 12: Classify tree health via GCC
        if detections and os.path.exists(ortho_path):
            logger.info("Step 12: Classifying tree health...")
            _update_drone_progress(project_id, "computing_heights", 98, "Classifying tree health (GCC)...")
            detections = _classify_health_gcc(detections, ortho_path)

        # Step 13: Insert trees into database
        if detections:
            logger.info(f"Step 13: Saving {len(detections)} trees...")
            _update_drone_progress(project_id, "computing_heights", 99,
                                   f"Saving {len(detections)} trees to database...")

            db.query(Tree).filter(Tree.project_id == project_id).delete()

            tree_records = []
            for idx, det in enumerate(detections):
                lat = det.get("center_lat")
                lon = det.get("center_lon")
                if lat is None or lon is None:
                    continue

                tree = Tree(
                    project_id=project_id,
                    tree_index=idx + 1,
                    latitude=lat,
                    longitude=lon,
                    height_m=det.get("height_m"),
                    health_status=det.get("health_status"),
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
            logger.info(f"Inserted {len(tree_records)} trees")

        # Step 14: Cleanup ortho tiles
        if os.path.exists(ortho_tiles_dir):
            shutil.rmtree(ortho_tiles_dir)

        # Step 15: Finalize
        project.status = ProjectStatus.READY
        project.processing_error = None
        _update_drone_job_db(db, project_id, DroneJobStatus.COMPLETED, 100)
        _update_drone_progress(project_id, "completed", 100, "Processing complete!")
        db.commit()
        logger.info(f"Recovery complete for project {project_id}")

    except Exception as e:
        logger.error(f"Recovery failed: {e}", exc_info=True)
        try:
            project = db.query(Project).filter(Project.id == project_id).first()
            if project:
                project.status = ProjectStatus.ERROR
                project.processing_error = str(e)
            _update_drone_job_db(db, project_id, DroneJobStatus.FAILED, 0, error_message=str(e))
            _update_drone_progress(project_id, "failed", 0, error=str(e))
            db.commit()
        except Exception:
            logger.error("Failed to update error state", exc_info=True)
    finally:
        db.close()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python recover_pipeline.py <project_id>")
        sys.exit(1)
    recover(sys.argv[1])
