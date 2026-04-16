import uuid
from uuid import UUID
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.database import get_db
from app.models import User, UserRole, Project, ClientSubAdminAssignment
from app.auth import require_admin, require_staff, hash_password
from app.schemas import UserCreate, UserResponse, UserUpdate, ClientSubAdminAssignmentsUpdate, SubAdminClientAssignmentsUpdate

router = APIRouter(prefix="/api/users", tags=["Users"])


def _user_to_response(u: User, db: Session) -> UserResponse:
    project_count = db.query(func.count(Project.id)).filter(Project.client_id == u.id).scalar()
    return UserResponse(
        id=u.id,
        username=u.username,
        full_name=u.full_name,
        role=u.role.value,
        created_at=u.created_at,
        project_count=project_count or 0,
        plain_password=u.plain_password,
    )


@router.get("", response_model=List[UserResponse])
def list_users(db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    users = db.query(User).order_by(User.created_at.desc()).all()
    return [_user_to_response(u, db) for u in users]


@router.get("/clients", response_model=List[UserResponse])
def list_clients(db: Session = Depends(get_db), staff: User = Depends(require_staff)):
    if staff.role == UserRole.SUB_ADMIN:
        # Sub-admins only see their assigned clients
        clients = (
            db.query(User)
            .join(ClientSubAdminAssignment, ClientSubAdminAssignment.client_id == User.id)
            .filter(
                ClientSubAdminAssignment.sub_admin_id == staff.id,
                User.role == UserRole.CLIENT,
            )
            .order_by(User.full_name)
            .all()
        )
    else:
        clients = db.query(User).filter(User.role == UserRole.CLIENT).order_by(User.full_name).all()
    return [_user_to_response(u, db) for u in clients]


@router.get("/sub-admins", response_model=List[UserResponse])
def list_sub_admins(db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    sub_admins = db.query(User).filter(User.role == UserRole.SUB_ADMIN).order_by(User.full_name).all()
    return [_user_to_response(u, db) for u in sub_admins]


@router.get("/clients/{client_id}/sub-admins", response_model=List[UserResponse])
def list_client_sub_admins(
    client_id: UUID,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    client = db.query(User).filter(User.id == client_id).first()
    if not client or client.role != UserRole.CLIENT:
        raise HTTPException(status_code=404, detail="Client not found")

    assigned_sub_admins = (
        db.query(User)
        .join(ClientSubAdminAssignment, ClientSubAdminAssignment.sub_admin_id == User.id)
        .filter(ClientSubAdminAssignment.client_id == client_id, User.role == UserRole.SUB_ADMIN)
        .order_by(User.full_name)
        .all()
    )
    return [_user_to_response(u, db) for u in assigned_sub_admins]


@router.put("/clients/{client_id}/sub-admins", response_model=List[UserResponse])
def replace_client_sub_admins(
    client_id: UUID,
    payload: ClientSubAdminAssignmentsUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    client = db.query(User).filter(User.id == client_id).first()
    if not client or client.role != UserRole.CLIENT:
        raise HTTPException(status_code=404, detail="Client not found")

    sub_admin_ids = list(dict.fromkeys(payload.sub_admin_ids))
    if sub_admin_ids:
        valid_sub_admins = db.query(User).filter(
            User.id.in_(sub_admin_ids),
            User.role == UserRole.SUB_ADMIN,
        ).all()
        valid_sub_admin_ids = {u.id for u in valid_sub_admins}
        invalid_ids = [sid for sid in sub_admin_ids if sid not in valid_sub_admin_ids]
        if invalid_ids:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid sub-admin IDs: {', '.join(str(i) for i in invalid_ids)}",
            )

    db.query(ClientSubAdminAssignment).filter(
        ClientSubAdminAssignment.client_id == client_id
    ).delete()

    for sub_admin_id in sub_admin_ids:
        db.add(ClientSubAdminAssignment(
            id=uuid.uuid4(),
            client_id=client_id,
            sub_admin_id=sub_admin_id,
        ))

    db.commit()

    assigned_sub_admins = (
        db.query(User)
        .join(ClientSubAdminAssignment, ClientSubAdminAssignment.sub_admin_id == User.id)
        .filter(ClientSubAdminAssignment.client_id == client_id, User.role == UserRole.SUB_ADMIN)
        .order_by(User.full_name)
        .all()
    )
    return [_user_to_response(u, db) for u in assigned_sub_admins]


@router.post("", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserCreate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    existing = db.query(User).filter(User.username == payload.username).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Username already taken",
        )

    user = User(
        username=payload.username,
        password_hash=hash_password(payload.password),
        plain_password=payload.password,
        full_name=payload.full_name,
        role=UserRole(payload.role.value),
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    return UserResponse(
        id=user.id,
        username=user.username,
        full_name=user.full_name,
        role=user.role.value,
        created_at=user.created_at,
        plain_password=user.plain_password,
    )


@router.put("/{user_id}", response_model=UserResponse)
def update_user(
    user_id: UUID,
    payload: UserUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if payload.username is not None and payload.username != user.username:
        existing = db.query(User).filter(User.username == payload.username).first()
        if existing:
            raise HTTPException(status_code=409, detail="Username already taken")
        user.username = payload.username

    if payload.full_name is not None:
        user.full_name = payload.full_name
        
    if payload.password is not None:
        user.password_hash = hash_password(payload.password)
        user.plain_password = payload.password
    
    db.commit()
    db.refresh(user)
    return _user_to_response(user, db)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: UUID,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Projects assigned to this client should be "Unassigned"
    from app.models import Project
    db.query(Project).filter(Project.client_id == user_id).update({Project.client_id: None})

    db.delete(user)
    db.commit()


# ── Sub-Admin ↔ Client assignment (from the sub-admin side) ──

@router.get("/sub-admins/{sub_admin_id}/clients", response_model=List[UserResponse])
def list_sub_admin_clients(
    sub_admin_id: UUID,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    sub_admin = db.query(User).filter(User.id == sub_admin_id).first()
    if not sub_admin or sub_admin.role != UserRole.SUB_ADMIN:
        raise HTTPException(status_code=404, detail="Sub-admin not found")

    assigned_clients = (
        db.query(User)
        .join(ClientSubAdminAssignment, ClientSubAdminAssignment.client_id == User.id)
        .filter(ClientSubAdminAssignment.sub_admin_id == sub_admin_id, User.role == UserRole.CLIENT)
        .order_by(User.full_name)
        .all()
    )
    return [_user_to_response(u, db) for u in assigned_clients]


@router.put("/sub-admins/{sub_admin_id}/clients", response_model=List[UserResponse])
def replace_sub_admin_clients(
    sub_admin_id: UUID,
    payload: SubAdminClientAssignmentsUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    sub_admin = db.query(User).filter(User.id == sub_admin_id).first()
    if not sub_admin or sub_admin.role != UserRole.SUB_ADMIN:
        raise HTTPException(status_code=404, detail="Sub-admin not found")

    client_ids = list(dict.fromkeys(payload.client_ids))
    if client_ids:
        valid_clients = db.query(User).filter(
            User.id.in_(client_ids),
            User.role == UserRole.CLIENT,
        ).all()
        valid_client_ids = {u.id for u in valid_clients}
        invalid_ids = [cid for cid in client_ids if cid not in valid_client_ids]
        if invalid_ids:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid client IDs: {', '.join(str(i) for i in invalid_ids)}",
            )

    db.query(ClientSubAdminAssignment).filter(
        ClientSubAdminAssignment.sub_admin_id == sub_admin_id
    ).delete()

    for client_id in client_ids:
        db.add(ClientSubAdminAssignment(
            id=uuid.uuid4(),
            client_id=client_id,
            sub_admin_id=sub_admin_id,
        ))

    db.commit()

    assigned_clients = (
        db.query(User)
        .join(ClientSubAdminAssignment, ClientSubAdminAssignment.client_id == User.id)
        .filter(ClientSubAdminAssignment.sub_admin_id == sub_admin_id, User.role == UserRole.CLIENT)
        .order_by(User.full_name)
        .all()
    )
    return [_user_to_response(u, db) for u in assigned_clients]
