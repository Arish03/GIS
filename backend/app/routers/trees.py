from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import func, case
from uuid import UUID

from app.database import get_db
from app.models import User, UserRole, Project, Tree, HealthStatus, ClientSubAdminAssignment
from app.auth import get_current_user, require_admin, require_staff
from app.schemas import (
    TreeResponse, AnalyticsResponse, HealthBreakdown, HeightBucket,
    GeoJSONFeature, GeoJSONFeatureCollection, ManualTreeCreate,
    ManualTreeBboxCreate, ManualTreeBboxUpdate,
)

router = APIRouter(prefix="/api/projects", tags=["Trees & Analytics"])


def _is_sub_admin_assigned_to_client(db: Session, sub_admin_id: UUID, client_id: UUID | None) -> bool:
    if client_id is None:
        return False
    assignment = db.query(ClientSubAdminAssignment).filter(
        ClientSubAdminAssignment.sub_admin_id == sub_admin_id,
        ClientSubAdminAssignment.client_id == client_id,
    ).first()
    return assignment is not None


def _check_project_access(project_id: UUID, user: User, db: Session) -> Project:
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if user.role == UserRole.CLIENT and project.client_id != user.id:
        raise HTTPException(status_code=403, detail="Access denied")
    if user.role == UserRole.SUB_ADMIN and not _is_sub_admin_assigned_to_client(db, user.id, project.client_id):
        raise HTTPException(status_code=403, detail="Access denied")
    return project


def _check_staff_write_access(project_id: UUID, user: User, db: Session) -> Project:
    """Staff can write; SUB_ADMIN only on projects for assigned clients."""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if user.role == UserRole.SUB_ADMIN and not _is_sub_admin_assigned_to_client(db, user.id, project.client_id):
        raise HTTPException(status_code=403, detail="Access denied")
    return project


@router.get("/{project_id}/trees")
def get_trees_geojson(
    project_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _check_project_access(project_id, user, db)

    trees = db.query(Tree).filter(Tree.project_id == project_id).all()

    features = []
    for tree in trees:
        feature = GeoJSONFeature(
            type="Feature",
            geometry={
                "type": "Point",
                "coordinates": [tree.longitude or 0, tree.latitude or 0],
            },
            properties={
                "id": str(tree.id),
                "tree_index": tree.tree_index,
                "height_m": tree.height_m,
                "health_status": tree.health_status.value if tree.health_status else None,
                "latitude": tree.latitude,
                "longitude": tree.longitude,
                "confidence": tree.confidence,
                "detection_source": tree.detection_source,
                "bbox_tl_lat": tree.bbox_tl_lat,
                "bbox_tl_lon": tree.bbox_tl_lon,
                "bbox_tr_lat": tree.bbox_tr_lat,
                "bbox_tr_lon": tree.bbox_tr_lon,
                "bbox_br_lat": tree.bbox_br_lat,
                "bbox_br_lon": tree.bbox_br_lon,
                "bbox_bl_lat": tree.bbox_bl_lat,
                "bbox_bl_lon": tree.bbox_bl_lon,
            },
        )
        features.append(feature)

    return GeoJSONFeatureCollection(
        type="FeatureCollection",
        features=features,
    )


@router.get("/{project_id}/trees/list")
def get_trees_list(
    project_id: UUID,
    health: str = None,
    search: str = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _check_project_access(project_id, user, db)

    query = db.query(Tree).filter(Tree.project_id == project_id)

    if health:
        try:
            health_enum = HealthStatus(health)
            query = query.filter(Tree.health_status == health_enum)
        except ValueError:
            pass

    if search:
        try:
            tree_idx = int(search)
            query = query.filter(Tree.tree_index == tree_idx)
        except ValueError:
            pass

    trees = query.order_by(Tree.tree_index).all()

    return [
        TreeResponse(
            id=t.id,
            tree_index=t.tree_index,
            height_m=t.height_m,
            health_status=t.health_status.value if t.health_status else None,
            latitude=t.latitude,
            longitude=t.longitude,
            confidence=t.confidence,
            detection_source=t.detection_source,
        )
        for t in trees
    ]


@router.get("/{project_id}/analytics", response_model=AnalyticsResponse)
def get_analytics(
    project_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = _check_project_access(project_id, user, db)

    # Aggregations
    total = db.query(func.count(Tree.id)).filter(Tree.project_id == project_id).scalar() or 0
    avg_height = db.query(func.avg(Tree.height_m)).filter(Tree.project_id == project_id).scalar()

    # Health breakdown
    health_counts = (
        db.query(
            Tree.health_status,
            func.count(Tree.id),
        )
        .filter(Tree.project_id == project_id)
        .group_by(Tree.health_status)
        .all()
    )

    breakdown = HealthBreakdown()
    for status, count in health_counts:
        if status == HealthStatus.HEALTHY:
            breakdown.healthy = count
        elif status == HealthStatus.MODERATE:
            breakdown.moderate = count
        elif status == HealthStatus.POOR:
            breakdown.poor = count

    health_score = None
    if total > 0:
        health_score = round((breakdown.healthy / total) * 100, 1)

    # Height distribution (buckets)
    buckets = [
        ("0-2m", 0, 2),
        ("2-4m", 2, 4),
        ("4-6m", 4, 6),
        ("6-8m", 6, 8),
        ("8-10m", 8, 10),
        ("10m+", 10, 9999),
    ]

    height_distribution = []
    for label, low, high in buckets:
        count = (
            db.query(func.count(Tree.id))
            .filter(
                Tree.project_id == project_id,
                Tree.height_m >= low,
                Tree.height_m < high,
            )
            .scalar()
            or 0
        )
        height_distribution.append(HeightBucket(range=label, count=count))

    return AnalyticsResponse(
        total_trees=total,
        average_height=round(avg_height, 2) if avg_height else None,
        health_score=health_score,
        area_hectares=project.area_hectares,
        health_breakdown=breakdown,
        height_distribution=height_distribution,
    )


# ── Manual Tree Annotation ───────────────────────────────────

@router.post("/{project_id}/trees/manual", response_model=TreeResponse, status_code=status.HTTP_201_CREATED)
def create_manual_tree(
    project_id: UUID,
    body: ManualTreeCreate,
    db: Session = Depends(get_db),
    staff: User = Depends(require_staff),
):
    """Create a manually-annotated tree from bbox corners drawn on the map."""
    project = _check_staff_write_access(project_id, staff, db)

    from app.tasks import compute_single_tree

    det = compute_single_tree(
        str(project_id),
        body.tl_lat, body.tl_lon, body.tr_lat, body.tr_lon,
        body.br_lat, body.br_lon, body.bl_lat, body.bl_lon,
    )

    # Determine next tree_index
    max_idx = db.query(func.max(Tree.tree_index)).filter(
        Tree.project_id == project_id
    ).scalar() or 0

    lat = det.get("center_lat")
    lon = det.get("center_lon")
    health = det.get("health_status")

    tree = Tree(
        project_id=project_id,
        tree_index=max_idx + 1,
        latitude=lat,
        longitude=lon,
        height_m=det.get("height_m"),
        health_status=health,
        confidence=None,
        detection_source="manual",
        xmin_px=det.get("xmin_px"),
        ymin_px=det.get("ymin_px"),
        xmax_px=det.get("xmax_px"),
        ymax_px=det.get("ymax_px"),
        bbox_tl_lat=body.tl_lat,
        bbox_tl_lon=body.tl_lon,
        bbox_tr_lat=body.tr_lat,
        bbox_tr_lon=body.tr_lon,
        bbox_br_lat=body.br_lat,
        bbox_br_lon=body.br_lon,
        bbox_bl_lat=body.bl_lat,
        bbox_bl_lon=body.bl_lon,
        geom=f"SRID=4326;POINT({lon} {lat})" if lat and lon else None,
    )
    db.add(tree)
    project.last_edited_by = staff.id
    db.commit()
    db.refresh(tree)

    return TreeResponse(
        id=tree.id,
        tree_index=tree.tree_index,
        height_m=tree.height_m,
        health_status=tree.health_status.value if tree.health_status else None,
        latitude=tree.latitude,
        longitude=tree.longitude,
        confidence=tree.confidence,
        detection_source=tree.detection_source,
    )


@router.delete("/{project_id}/trees/{tree_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_tree(
    project_id: UUID,
    tree_id: UUID,
    db: Session = Depends(get_db),
    staff: User = Depends(require_staff),
):
    """Delete a tree (auto-detected or manual) and renumber remaining trees."""
    project = _check_staff_write_access(project_id, staff, db)
    tree = db.query(Tree).filter(
        Tree.id == tree_id, Tree.project_id == project_id
    ).first()
    if not tree:
        raise HTTPException(status_code=404, detail="Tree not found")
    db.delete(tree)
    db.flush()

    # Renumber all remaining trees for this project
    remaining = (
        db.query(Tree)
        .filter(Tree.project_id == project_id)
        .order_by(Tree.tree_index)
        .all()
    )
    for idx, t in enumerate(remaining, start=1):
        t.tree_index = idx

    project.last_edited_by = staff.id
    db.commit()
    return


@router.post("/{project_id}/trees/manual/bbox", response_model=TreeResponse, status_code=status.HTTP_201_CREATED)
def create_manual_tree_bbox(
    project_id: UUID,
    body: ManualTreeBboxCreate,
    db: Session = Depends(get_db),
    staff: User = Depends(require_staff),
):
    """Create a manual tree from bbox corners WITHOUT computing height/health."""
    project = _check_staff_write_access(project_id, staff, db)

    center_lat = (body.tl_lat + body.br_lat) / 2
    center_lon = (body.tl_lon + body.br_lon) / 2

    max_idx = db.query(func.max(Tree.tree_index)).filter(
        Tree.project_id == project_id
    ).scalar() or 0

    tree = Tree(
        project_id=project_id,
        tree_index=max_idx + 1,
        latitude=center_lat,
        longitude=center_lon,
        height_m=None,
        health_status=None,
        confidence=None,
        detection_source="manual",
        bbox_tl_lat=body.tl_lat,
        bbox_tl_lon=body.tl_lon,
        bbox_tr_lat=body.tr_lat,
        bbox_tr_lon=body.tr_lon,
        bbox_br_lat=body.br_lat,
        bbox_br_lon=body.br_lon,
        bbox_bl_lat=body.bl_lat,
        bbox_bl_lon=body.bl_lon,
        geom=f"SRID=4326;POINT({center_lon} {center_lat})",
    )
    db.add(tree)
    project.last_edited_by = staff.id
    db.commit()
    db.refresh(tree)

    return TreeResponse(
        id=tree.id,
        tree_index=tree.tree_index,
        height_m=tree.height_m,
        health_status=tree.health_status.value if tree.health_status else None,
        latitude=tree.latitude,
        longitude=tree.longitude,
        confidence=tree.confidence,
        detection_source=tree.detection_source,
        bbox_tl_lat=tree.bbox_tl_lat,
        bbox_tl_lon=tree.bbox_tl_lon,
        bbox_tr_lat=tree.bbox_tr_lat,
        bbox_tr_lon=tree.bbox_tr_lon,
        bbox_br_lat=tree.bbox_br_lat,
        bbox_br_lon=tree.bbox_br_lon,
        bbox_bl_lat=tree.bbox_bl_lat,
        bbox_bl_lon=tree.bbox_bl_lon,
    )


@router.put("/{project_id}/trees/{tree_id}/bbox", response_model=TreeResponse)
def update_tree_bbox(
    project_id: UUID,
    tree_id: UUID,
    body: ManualTreeBboxUpdate,
    db: Session = Depends(get_db),
    staff: User = Depends(require_staff),
):
    """Update a tree's bounding box (move / resize). Clears computed height/health."""
    project = _check_staff_write_access(project_id, staff, db)
    tree = db.query(Tree).filter(
        Tree.id == tree_id, Tree.project_id == project_id
    ).first()
    if not tree:
        raise HTTPException(status_code=404, detail="Tree not found")

    center_lat = (body.tl_lat + body.br_lat) / 2
    center_lon = (body.tl_lon + body.br_lon) / 2

    tree.bbox_tl_lat = body.tl_lat
    tree.bbox_tl_lon = body.tl_lon
    tree.bbox_tr_lat = body.tr_lat
    tree.bbox_tr_lon = body.tr_lon
    tree.bbox_br_lat = body.br_lat
    tree.bbox_br_lon = body.br_lon
    tree.bbox_bl_lat = body.bl_lat
    tree.bbox_bl_lon = body.bl_lon
    tree.latitude = center_lat
    tree.longitude = center_lon
    tree.height_m = None
    tree.health_status = None
    tree.geom = f"SRID=4326;POINT({center_lon} {center_lat})"

    project.last_edited_by = staff.id
    db.commit()
    db.refresh(tree)

    return TreeResponse(
        id=tree.id,
        tree_index=tree.tree_index,
        height_m=tree.height_m,
        health_status=tree.health_status.value if tree.health_status else None,
        latitude=tree.latitude,
        longitude=tree.longitude,
        confidence=tree.confidence,
        detection_source=tree.detection_source,
        bbox_tl_lat=tree.bbox_tl_lat,
        bbox_tl_lon=tree.bbox_tl_lon,
        bbox_tr_lat=tree.bbox_tr_lat,
        bbox_tr_lon=tree.bbox_tr_lon,
        bbox_br_lat=tree.bbox_br_lat,
        bbox_br_lon=tree.bbox_br_lon,
        bbox_bl_lat=tree.bbox_bl_lat,
        bbox_bl_lon=tree.bbox_bl_lon,
    )


@router.post("/{project_id}/trees/calculate-heights")
def calculate_heights(
    project_id: UUID,
    db: Session = Depends(get_db),
    staff: User = Depends(require_staff),
):
    """Compute height & health for all manual trees that have no height yet."""
    project = _check_staff_write_access(project_id, staff, db)

    from app.tasks import compute_single_tree

    pending = (
        db.query(Tree)
        .filter(
            Tree.project_id == project_id,
            Tree.height_m.is_(None),
            Tree.bbox_tl_lat.isnot(None),
        )
        .all()
    )

    updated = 0
    for tree in pending:
        try:
            det = compute_single_tree(
                str(project_id),
                tree.bbox_tl_lat, tree.bbox_tl_lon,
                tree.bbox_tr_lat, tree.bbox_tr_lon,
                tree.bbox_br_lat, tree.bbox_br_lon,
                tree.bbox_bl_lat, tree.bbox_bl_lon,
            )
            tree.height_m = det.get("height_m")
            tree.health_status = det.get("health_status")
            tree.xmin_px = det.get("xmin_px")
            tree.ymin_px = det.get("ymin_px")
            tree.xmax_px = det.get("xmax_px")
            tree.ymax_px = det.get("ymax_px")
            updated += 1
        except Exception as e:
            import logging
            logging.getLogger(__name__).error(f"Failed to compute height for tree {tree.id}: {e}")

    project.last_edited_by = staff.id
    db.commit()
    return {"updated": updated, "total_pending": len(pending)}
