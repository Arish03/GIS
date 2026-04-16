import os
import shutil
import json
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status
from sqlalchemy.orm import Session
from uuid import UUID
from typing import List

from app.database import get_db
from app.models import User, UserRole, Project, ProjectStatus, DroneProcessingJob, DroneJobStatus, ClientSubAdminAssignment
from app.auth import require_admin, require_staff, get_current_user
from app.config import get_settings
from app.schemas import ProcessingStatus, DroneUploadResponse, DroneProcessResponse, DroneProgressResponse
from app.celery_app import redis_client

settings = get_settings()
router = APIRouter(prefix="/api/projects", tags=["Upload"])

ALLOWED_EXTENSIONS = {".shp", ".shx", ".dbf", ".prj", ".cpg", ".tif", ".tiff"}


def _can_access_project(user: User, project: Project, db: Session) -> bool:
    if user.role == UserRole.ADMIN:
        return True
    if user.role == UserRole.CLIENT:
        return project.client_id == user.id
    if user.role == UserRole.SUB_ADMIN:
        if project.client_id is None:
            return False
        assignment = db.query(ClientSubAdminAssignment).filter(
            ClientSubAdminAssignment.sub_admin_id == user.id,
            ClientSubAdminAssignment.client_id == project.client_id,
        ).first()
        return assignment is not None
    return False


@router.post("/{project_id}/upload/{layer_type}", status_code=status.HTTP_202_ACCEPTED)
def upload_project_layer(
    project_id: UUID,
    layer_type: str,
    files: List[UploadFile] = File(...),
    db: Session = Depends(get_db),
    staff: User = Depends(require_staff),
):
    if layer_type not in ["ortho", "dtm", "dsm", "boundary", "trees", "health"]:
        raise HTTPException(status_code=400, detail="Invalid layer type")

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if not _can_access_project(staff, project, db):
        raise HTTPException(status_code=403, detail="Access denied")

    # Validate file extensions
    allowed = ALLOWED_EXTENSIONS
    for f in files:
        ext = os.path.splitext(f.filename)[1].lower()
        if ext not in allowed:
            raise HTTPException(
                status_code=400,
                detail=f"File type '{ext}' not allowed. Allowed: {', '.join(allowed)}",
            )

    # Create upload directory for this project
    upload_dir = os.path.join(settings.UPLOAD_DIR, str(project_id))
    os.makedirs(upload_dir, exist_ok=True)

    # Save files
    saved_files = []
    for f in files:
        # For ortho, dtm, dsm, we might want to normalize the names for the processor
        filename = f.filename
        if layer_type == "ortho" and f.filename.lower().endswith((".tif", ".tiff")):
            filename = "ortho.tif"
        elif layer_type == "dtm" and f.filename.lower().endswith((".tif", ".tiff")):
            filename = "dtm.tif"
        elif layer_type == "dsm" and f.filename.lower().endswith((".tif", ".tiff")):
            filename = "dsm.tif"
        
        file_path = os.path.join(upload_dir, filename)
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(f.file, buffer)
        saved_files.append(filename)

    project.status = ProjectStatus.UPLOADING
    db.commit()

    return {
        "message": f"Files for {layer_type} uploaded successfully.",
        "project_id": str(project_id),
        "files": saved_files,
    }


@router.post("/{project_id}/process", status_code=status.HTTP_202_ACCEPTED)
def trigger_processing(
    project_id: UUID,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if not _can_access_project(admin, project, db):
        raise HTTPException(status_code=403, detail="Access denied")

    # Update project status
    project.status = ProjectStatus.PROCESSING
    db.commit()

    # Trigger async processing
    from app.tasks import process_project_files
    process_project_files.delay(str(project_id))

    return {
        "message": "GIS processing task triggered.",
        "project_id": str(project_id),
    }


@router.get("/{project_id}/status", response_model=ProcessingStatus)
def get_processing_status(
    project_id: UUID,
    db: Session = Depends(get_db),
    staff: User = Depends(require_staff),
):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if not _can_access_project(staff, project, db):
        raise HTTPException(status_code=403, detail="Access denied")

    return ProcessingStatus(
        project_id=project.id,
        status=project.status.value,
        error=project.processing_error,
    )


@router.delete("/{project_id}/upload/{layer_type}/{filename}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project_layer_file(
    project_id: UUID,
    layer_type: str,
    filename: str,
    db: Session = Depends(get_db),
    staff: User = Depends(require_staff),
):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if not _can_access_project(staff, project, db):
        raise HTTPException(status_code=403, detail="Access denied")

    # Determine the actual filename on disk
    actual_filename = filename
    if layer_type == "ortho" and filename.lower().endswith((".tif", ".tiff")):
        actual_filename = "ortho.tif"
    elif layer_type == "dtm" and filename.lower().endswith((".tif", ".tiff")):
        actual_filename = "dtm.tif"
    elif layer_type == "dsm" and filename.lower().endswith((".tif", ".tiff")):
        actual_filename = "dsm.tif"

    file_path = os.path.join(settings.UPLOAD_DIR, str(project_id), actual_filename)
    
    if os.path.exists(file_path):
        os.remove(file_path)
    
    # Optional: If the directory is now empty or missing required files, 
    # the frontend will handle resetting the status to 'pending'.
    
    return


# ── Drone Flight Upload Endpoints ────────────────────────────

ALLOWED_IMAGE_EXTENSIONS = {".jpg", ".jpeg"}


@router.post(
    "/{project_id}/drone-upload",
    status_code=status.HTTP_202_ACCEPTED,
    response_model=DroneUploadResponse,
)
def upload_drone_images(
    project_id: UUID,
    files: List[UploadFile] = File(...),
    db: Session = Depends(get_db),
    staff: User = Depends(require_staff),
):
    """Accept batches of drone images and stage them on disk."""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if not _can_access_project(staff, project, db):
        raise HTTPException(status_code=403, detail="Access denied")

    # Validate file extensions
    for f in files:
        ext = os.path.splitext(f.filename)[1].lower()
        if ext not in ALLOWED_IMAGE_EXTENSIONS:
            raise HTTPException(
                status_code=400,
                detail=f"File '{f.filename}' is not a JPEG image. Only .jpg/.jpeg files are accepted.",
            )

    # Create staging directory
    staging_dir = os.path.join(settings.UPLOAD_DIR, str(project_id), "drone-images")
    os.makedirs(staging_dir, exist_ok=True)

    # Save files to staging
    for f in files:
        # Sanitize filename: keep only alphanumeric, dash, underscore, dot
        safe_name = "".join(c for c in f.filename if c.isalnum() or c in "-_.")
        if not safe_name:
            safe_name = f"image_{os.urandom(4).hex()}.jpg"
        file_path = os.path.join(staging_dir, safe_name)
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(f.file, buffer)

    # Count total staged images
    total_staged = len([
        f for f in os.listdir(staging_dir)
        if os.path.splitext(f)[1].lower() in ALLOWED_IMAGE_EXTENSIONS
    ])

    # Create or update DroneProcessingJob record
    drone_job = db.query(DroneProcessingJob).filter(
        DroneProcessingJob.project_id == project_id
    ).first()

    if not drone_job:
        drone_job = DroneProcessingJob(
            project_id=project_id,
            status=DroneJobStatus.UPLOADING,
            image_count=total_staged,
        )
        db.add(drone_job)
    else:
        drone_job.status = DroneJobStatus.UPLOADING
        drone_job.image_count = total_staged
        drone_job.error_message = None

    project.status = ProjectStatus.UPLOADING
    db.commit()
    db.refresh(drone_job)

    return DroneUploadResponse(
        files_received=len(files),
        total_staged=total_staged,
        job_id=str(drone_job.id),
    )


@router.post(
    "/{project_id}/drone-process",
    status_code=status.HTTP_202_ACCEPTED,
    response_model=DroneProcessResponse,
)
def trigger_drone_processing(
    project_id: UUID,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Trigger async NodeODM processing for staged drone images."""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    staging_dir = os.path.join(settings.UPLOAD_DIR, str(project_id), "drone-images")
    if not os.path.exists(staging_dir):
        raise HTTPException(status_code=400, detail="No drone images have been uploaded yet.")

    image_files = [
        f for f in os.listdir(staging_dir)
        if os.path.splitext(f)[1].lower() in ALLOWED_IMAGE_EXTENSIONS
    ]
    if len(image_files) < 2:
        raise HTTPException(
            status_code=400,
            detail=f"At least 2 images are required for photogrammetry. Found {len(image_files)}.",
        )

    # Get or create drone job
    drone_job = db.query(DroneProcessingJob).filter(
        DroneProcessingJob.project_id == project_id
    ).first()
    if not drone_job:
        drone_job = DroneProcessingJob(
            project_id=project_id,
            image_count=len(image_files),
        )
        db.add(drone_job)

    drone_job.status = DroneJobStatus.QUEUED
    drone_job.progress = 0
    drone_job.error_message = None
    drone_job.completed_at = None

    project.status = ProjectStatus.PROCESSING
    project.processing_error = None
    db.commit()
    db.refresh(drone_job)

    # Dispatch Celery task
    from app.tasks import process_drone_flight
    process_drone_flight.delay(str(project_id))

    return DroneProcessResponse(
        job_id=str(drone_job.id),
        status=drone_job.status.value,
        message=f"Processing queued for {len(image_files)} images.",
    )


@router.get(
    "/{project_id}/drone-status",
    response_model=DroneProgressResponse,
)
def get_drone_processing_status(
    project_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Get real-time drone processing progress (reads from Redis, falls back to DB)."""
    drone_job = db.query(DroneProcessingJob).filter(
        DroneProcessingJob.project_id == project_id
    ).first()

    if not drone_job:
        raise HTTPException(status_code=404, detail="No drone processing job found for this project.")

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if not _can_access_project(user, project, db):
        raise HTTPException(status_code=403, detail="Access denied")

    # Try to get live progress from Redis (fast path)
    redis_key = f"drone_progress:{project_id}"
    cached = redis_client.get(redis_key)
    if cached:
        try:
            data = json.loads(cached)
            return DroneProgressResponse(
                job_id=str(drone_job.id),
                status=data.get("status", drone_job.status.value),
                progress=data.get("progress", drone_job.progress),
                image_count=drone_job.image_count,
                message=data.get("message"),
                error=data.get("error"),
            )
        except (json.JSONDecodeError, KeyError):
            pass

    # Fallback: read from DB
    return DroneProgressResponse(
        job_id=str(drone_job.id),
        status=drone_job.status.value,
        progress=drone_job.progress,
        image_count=drone_job.image_count,
        message=None,
        error=drone_job.error_message,
    )
