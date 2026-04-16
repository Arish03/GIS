import os
import json
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List
from uuid import UUID

from app.database import get_db
from app.models import User, UserRole, Project, ProjectStatus, Tree, ClientSubAdminAssignment
from app.auth import get_current_user, require_admin, require_staff
from app.schemas import (
    ProjectCreate, ProjectUpdate, ProjectResponse, ProjectListResponse
)

router = APIRouter(prefix="/api/projects", tags=["Projects"])


def _is_sub_admin_assigned_to_client(db: Session, sub_admin_id: UUID, client_id: UUID | None) -> bool:
    if client_id is None:
        return False
    assignment = db.query(ClientSubAdminAssignment).filter(
        ClientSubAdminAssignment.sub_admin_id == sub_admin_id,
        ClientSubAdminAssignment.client_id == client_id,
    ).first()
    return assignment is not None


def _project_to_response(project: Project, db: Session) -> ProjectResponse:
    tree_count = db.query(func.count(Tree.id)).filter(Tree.project_id == project.id).scalar()
    client_name = None
    if project.client:
        client_name = project.client.full_name
    created_by_name = None
    if project.creator:
        created_by_name = project.creator.full_name
    reviewed_by_name = None
    if project.reviewer:
        reviewed_by_name = project.reviewer.full_name
    last_edited_by_name = None
    if project.last_editor:
        last_edited_by_name = project.last_editor.full_name
    return ProjectResponse(
        id=project.id,
        name=project.name,
        location=project.location,
        description=project.description,
        client_id=project.client_id,
        client_name=client_name,
        created_by=project.created_by,
        created_by_name=created_by_name,
        reviewed_by=project.reviewed_by,
        reviewed_by_name=reviewed_by_name,
        reviewed_at=project.reviewed_at,
        last_edited_by=project.last_edited_by,
        last_edited_by_name=last_edited_by_name,
        status=project.status.value,
        boundary_geojson=project.boundary_geojson,
        area_hectares=project.area_hectares,
        created_at=project.created_at,
        updated_at=project.updated_at,
        processing_error=project.processing_error,
        tree_count=tree_count,
    )


@router.get("", response_model=ProjectListResponse)
def list_projects(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    query = db.query(Project)
    
    # Clients only see their READY projects
    if user.role == UserRole.CLIENT:
        query = query.filter(
            Project.client_id == user.id,
            Project.status == ProjectStatus.READY
        )
    elif user.role == UserRole.SUB_ADMIN:
        # Sub-admins only see projects of their assigned clients
        assigned_client_ids = [
            a.client_id for a in
            db.query(ClientSubAdminAssignment.client_id)
            .filter(ClientSubAdminAssignment.sub_admin_id == user.id)
            .all()
        ]
        query = query.filter(Project.client_id.in_(assigned_client_ids))
    # ADMIN sees all projects
    
    projects = query.order_by(Project.created_at.desc()).all()
    return ProjectListResponse(
        projects=[_project_to_response(p, db) for p in projects],
        total=len(projects),
    )


@router.get("/{project_id}", response_model=ProjectResponse)
def get_project(
    project_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Clients can only view their own projects
    if user.role == UserRole.CLIENT and project.client_id != user.id:
        raise HTTPException(status_code=403, detail="Access denied")
    # Sub-admins can only view projects of their assigned clients
    if user.role == UserRole.SUB_ADMIN:
        assigned = db.query(ClientSubAdminAssignment).filter(
            ClientSubAdminAssignment.sub_admin_id == user.id,
            ClientSubAdminAssignment.client_id == project.client_id,
        ).first()
        if not assigned:
            raise HTTPException(status_code=403, detail="Access denied")

    return _project_to_response(project, db)


@router.post("", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
def create_project(
    payload: ProjectCreate,
    db: Session = Depends(get_db),
    staff: User = Depends(require_staff),
):
    # Sub-admins can only create projects for their assigned clients
    if staff.role == UserRole.SUB_ADMIN:
        if payload.client_id is None:
            raise HTTPException(status_code=403, detail="Sub-admins must assign projects to one of their clients")
        if not _is_sub_admin_assigned_to_client(db, staff.id, payload.client_id):
            raise HTTPException(status_code=403, detail="You can only create projects for your assigned clients")

    project = Project(
        name=payload.name,
        location=payload.location,
        description=payload.description,
        client_id=payload.client_id,
        created_by=staff.id,
        status=ProjectStatus.DRAFT,
    )
    db.add(project)
    db.commit()
    db.refresh(project)
    return _project_to_response(project, db)


@router.put("/{project_id}", response_model=ProjectResponse)
def update_project(
    project_id: UUID,
    payload: ProjectUpdate,
    db: Session = Depends(get_db),
    staff: User = Depends(require_staff),
):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # SUB_ADMIN restrictions: cannot change client_id
    if staff.role == UserRole.SUB_ADMIN:
        if "client_id" in payload.model_fields_set:
            raise HTTPException(status_code=403, detail="Sub-admins cannot reassign project clients")
        # Verify sub-admin is assigned to this project's client
        if not _is_sub_admin_assigned_to_client(db, staff.id, project.client_id):
            raise HTTPException(status_code=403, detail="Access denied")

    if payload.name is not None:
        project.name = payload.name
    if payload.location is not None:
        project.location = payload.location
    if payload.description is not None:
        project.description = payload.description
    
    # Handle client assignment and status
    if "client_id" in payload.model_fields_set:
        if payload.client_id is None:
            project.client_id = None
            project.status = ProjectStatus.UNASSIGNED
        else:
            assigned_client = db.query(User).filter(User.id == payload.client_id).first()
            if not assigned_client or assigned_client.role != UserRole.CLIENT:
                raise HTTPException(status_code=400, detail="Assigned client_id must belong to a CLIENT user")
            project.client_id = payload.client_id
            # If it was unassigned, move it to CREATED (or READY if it has trees)
            if project.status == ProjectStatus.UNASSIGNED:
                # Check if it has trees (processed)
                tree_count = db.query(func.count(Tree.id)).filter(Tree.project_id == project.id).scalar()
                project.status = ProjectStatus.READY if tree_count > 0 else ProjectStatus.CREATED

    if "status" in payload.model_fields_set and payload.status is not None:
        try:
            next_status = ProjectStatus(payload.status)
            project.status = next_status
            if next_status == ProjectStatus.READY and staff.role in (UserRole.ADMIN, UserRole.SUB_ADMIN):
                project.reviewed_by = staff.id
                project.reviewed_at = datetime.utcnow()
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid status")
    
    project.last_edited_by = staff.id
    db.commit()
    db.refresh(project)
    return _project_to_response(project, db)


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(
    project_id: UUID,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Physical File Cleanup
    import shutil
    from app.config import get_settings
    settings = get_settings()
    
    upload_path = os.path.join(settings.UPLOAD_DIR, str(project_id))
    tiles_path = os.path.join(settings.TILES_DIR, str(project_id))
    
    if os.path.exists(upload_path):
        shutil.rmtree(upload_path)
    if os.path.exists(tiles_path):
        shutil.rmtree(tiles_path)

    db.delete(project)
    db.commit()


from pydantic import BaseModel
from typing import Any


class BoundarySaveRequest(BaseModel):
    geojson: Any  # GeoJSON FeatureCollection or Feature with Polygon geometry


@router.post("/{project_id}/boundary")
def save_boundary(
    project_id: UUID,
    payload: BoundarySaveRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_staff),
):
    """
    Save a hand-drawn boundary polygon for the project.
    Deletes all trees whose center falls outside the boundary and renumbers
    the remaining trees sequentially.
    """
    from shapely.geometry import shape, Point

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if admin.role == UserRole.SUB_ADMIN and not _is_sub_admin_assigned_to_client(db, admin.id, project.client_id):
        raise HTTPException(status_code=403, detail="Access denied")

    geojson = payload.geojson
    if isinstance(geojson, str):
        geojson = json.loads(geojson)

    # Extract polygon geometry from GeoJSON (FeatureCollection, Feature, or raw Geometry)
    geom_dict = None
    if geojson.get("type") == "FeatureCollection":
        features = geojson.get("features", [])
        if features:
            geom_dict = features[0].get("geometry")
    elif geojson.get("type") == "Feature":
        geom_dict = geojson.get("geometry")
    elif geojson.get("type") in ("Polygon", "MultiPolygon"):
        geom_dict = geojson
    
    if not geom_dict:
        raise HTTPException(status_code=400, detail="No polygon geometry found in GeoJSON")

    try:
        boundary_shape = shape(geom_dict)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid polygon geometry")

    if not boundary_shape.is_valid:
        boundary_shape = boundary_shape.buffer(0)

    # Store GeoJSON as FeatureCollection
    if geojson.get("type") != "FeatureCollection":
        stored_geojson = {
            "type": "FeatureCollection",
            "features": [{
                "type": "Feature",
                "properties": {},
                "geometry": geom_dict,
            }],
        }
    else:
        stored_geojson = geojson

    project.boundary_geojson = json.dumps(stored_geojson)

    # Compute area in hectares (approximate using geodesic)
    try:
        from pyproj import Geod
        geod = Geod(ellps="WGS84")
        area_m2, _ = geod.geometry_area_perimeter(boundary_shape)
        project.area_hectares = round(abs(area_m2) / 10000.0, 2)
    except Exception:
        project.area_hectares = None

    # Delete trees outside the boundary
    trees = db.query(Tree).filter(Tree.project_id == project_id).all()
    removed = 0
    for tree in trees:
        if tree.latitude is not None and tree.longitude is not None:
            pt = Point(tree.longitude, tree.latitude)
            if not boundary_shape.contains(pt):
                db.delete(tree)
                removed += 1

    db.flush()

    # Renumber remaining trees
    remaining = (
        db.query(Tree)
        .filter(Tree.project_id == project_id)
        .order_by(Tree.tree_index)
        .all()
    )
    for idx, t in enumerate(remaining, start=1):
        t.tree_index = idx

    project.last_edited_by = admin.id
    db.commit()
    db.refresh(project)

    return {
        "boundary_geojson": project.boundary_geojson,
        "area_hectares": project.area_hectares,
        "trees_removed": removed,
        "trees_remaining": len(remaining),
    }
