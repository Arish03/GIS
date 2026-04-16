"""Router for vegetation-index overlay tiles and metadata."""
import os
from fastapi import APIRouter, HTTPException, Depends, Query, Response
from uuid import UUID
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User, UserRole, Project, ClientSubAdminAssignment
from app.auth import get_current_user
from app.config import get_settings
from app.vegetation import render_index_tile, render_ortho_tile, get_available_indices, INDICES, PALETTES

settings = get_settings()
router = APIRouter(tags=["Vegetation Index"])


@router.get("/api/projects/{project_id}/vegetation-indices")
def list_vegetation_indices(
    project_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Return available vegetation indices based on the project's ortho bands."""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if user.role == UserRole.CLIENT and project.client_id != user.id:
        raise HTTPException(status_code=403, detail="Access denied")
    if user.role == UserRole.SUB_ADMIN:
        assignment = db.query(ClientSubAdminAssignment).filter(
            ClientSubAdminAssignment.sub_admin_id == user.id,
            ClientSubAdminAssignment.client_id == project.client_id,
        ).first()
        if not assignment:
            raise HTTPException(status_code=403, detail="Access denied")

    ortho_path = os.path.join(settings.UPLOAD_DIR, str(project_id), "ortho.tif")
    if not os.path.exists(ortho_path):
        return {"indices": [], "palettes": list(PALETTES.keys()), "default_index": None}

    indices = get_available_indices(ortho_path)
    # Default: VARI for RGB, NDVI if NIR available
    available_names = [i["name"] for i in indices]
    if "NDVI" in available_names:
        default = "NDVI"
    elif "VARI" in available_names:
        default = "VARI"
    elif indices:
        default = indices[0]["name"]
    else:
        default = None

    return {
        "indices": indices,
        "palettes": list(PALETTES.keys()),
        "default_index": default,
    }


# Transparent 1x1 PNG constant for out-of-bounds tiles
_TRANSPARENT_1X1 = (
    b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01'
    b'\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89'
    b'\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01'
    b'\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82'
)


@router.get("/tiles/{project_id}/ortho/{z}/{x}/{y}.png")
def get_ortho_tile(project_id: str, z: int, x: int, y: int):
    """Render an orthomosaic tile dynamically from the source GeoTIFF."""
    ortho_path = os.path.join(settings.UPLOAD_DIR, project_id, "ortho.tif")
    if not os.path.exists(ortho_path):
        raise HTTPException(status_code=404, detail="Ortho not found")

    try:
        png_bytes = render_ortho_tile(ortho_path, z, x, y)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    if png_bytes is None:
        return Response(
            content=_TRANSPARENT_1X1,
            media_type="image/png",
            headers={"Cache-Control": "public, max-age=3600"},
        )

    return Response(
        content=png_bytes,
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=300"},
    )


@router.get("/tiles/{project_id}/vi/{z}/{x}/{y}.png")
def get_vegetation_tile(
    project_id: str,
    z: int,
    x: int,
    y: int,
    index: str = Query("VARI", description="Vegetation index name"),
    palette: str = Query("rdylgn", description="Color palette name"),
):
    """Render a vegetation index tile as PNG."""
    ortho_path = os.path.join(settings.UPLOAD_DIR, project_id, "ortho.tif")
    if not os.path.exists(ortho_path):
        raise HTTPException(status_code=404, detail="Ortho not found")

    if index not in INDICES:
        raise HTTPException(status_code=400, detail=f"Unknown index: {index}")
    if palette not in PALETTES:
        palette = "rdylgn"

    try:
        png_bytes = render_index_tile(ortho_path, z, x, y, index, palette)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    if png_bytes is None:
        # Return transparent 1x1 PNG for out-of-bounds tiles
        return Response(
            content=_TRANSPARENT_1X1,
            media_type="image/png",
            headers={"Cache-Control": "public, max-age=3600"},
        )

    return Response(
        content=png_bytes,
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=300"},
    )
