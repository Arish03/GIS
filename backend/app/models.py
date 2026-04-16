import uuid
from datetime import datetime
from sqlalchemy import (
    Column, String, Float, DateTime, ForeignKey, Enum as SQLEnum, Integer, Text, UniqueConstraint
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from geoalchemy2 import Geometry
import enum

from app.database import Base


class UserRole(str, enum.Enum):
    ADMIN = "ADMIN"
    SUB_ADMIN = "SUB_ADMIN"
    CLIENT = "CLIENT"


class ProjectStatus(str, enum.Enum):
    DRAFT = "DRAFT"
    CREATED = "CREATED"
    UNASSIGNED = "UNASSIGNED"
    UPLOADING = "UPLOADING"
    PROCESSING = "PROCESSING"
    REVIEW_PENDING = "REVIEW_PENDING"
    REVIEW = "REVIEW"
    READY = "READY"
    ERROR = "ERROR"


class HealthStatus(str, enum.Enum):
    HEALTHY = "Healthy"
    MODERATE = "Moderate"
    POOR = "Poor"


class DroneJobStatus(str, enum.Enum):
    UPLOADING = "uploading"
    QUEUED = "queued"
    PROCESSING = "processing"
    DOWNLOADING = "downloading"
    TILING = "tiling"
    DETECTING = "detecting"
    COMPUTING_HEIGHTS = "computing_heights"
    COMPLETED = "completed"
    FAILED = "failed"


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    username = Column(String(100), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    plain_password = Column(String(255), nullable=True)
    full_name = Column(String(200), nullable=False)
    role = Column(SQLEnum(UserRole), nullable=False, default=UserRole.CLIENT)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Projects assigned to this client
    projects = relationship("Project", back_populates="client", foreign_keys="Project.client_id")
    client_sub_admin_links = relationship(
        "ClientSubAdminAssignment",
        foreign_keys="ClientSubAdminAssignment.client_id",
        back_populates="client",
        cascade="all, delete-orphan",
    )
    sub_admin_client_links = relationship(
        "ClientSubAdminAssignment",
        foreign_keys="ClientSubAdminAssignment.sub_admin_id",
        back_populates="sub_admin",
        cascade="all, delete-orphan",
    )


class ClientSubAdminAssignment(Base):
    __tablename__ = "client_sub_admin_assignments"
    __table_args__ = (
        UniqueConstraint("client_id", "sub_admin_id", name="uq_client_sub_admin_assignment"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    client_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    sub_admin_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    client = relationship("User", foreign_keys=[client_id], back_populates="client_sub_admin_links")
    sub_admin = relationship("User", foreign_keys=[sub_admin_id], back_populates="sub_admin_client_links")


class Project(Base):
    __tablename__ = "projects"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(200), nullable=False)
    location = Column(String(300), nullable=True)
    description = Column(Text, nullable=True)
    client_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    reviewed_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    last_edited_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    status = Column(SQLEnum(ProjectStatus), default=ProjectStatus.DRAFT, nullable=False)
    boundary_geojson = Column(Text, nullable=True)  # Store boundary as GeoJSON text
    area_hectares = Column(Float, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    processing_error = Column(Text, nullable=True)

    # Relationships
    client = relationship("User", back_populates="projects", foreign_keys=[client_id])
    creator = relationship("User", foreign_keys=[created_by])
    reviewer = relationship("User", foreign_keys=[reviewed_by])
    last_editor = relationship("User", foreign_keys=[last_edited_by])
    trees = relationship("Tree", back_populates="project", cascade="all, delete-orphan")
    drone_job = relationship("DroneProcessingJob", back_populates="project", uselist=False, cascade="all, delete-orphan")


class Tree(Base):
    __tablename__ = "trees"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    tree_index = Column(Integer, nullable=False)
    geom = Column(Geometry(geometry_type="POINT", srid=4326), nullable=False)
    height_m = Column(Float, nullable=True)
    health_status = Column(SQLEnum(HealthStatus), nullable=True)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    confidence = Column(Float, nullable=True)
    detection_source = Column(String(20), nullable=True, default="auto")
    xmin_px = Column(Integer, nullable=True)
    ymin_px = Column(Integer, nullable=True)
    xmax_px = Column(Integer, nullable=True)
    ymax_px = Column(Integer, nullable=True)
    bbox_tl_lat = Column(Float, nullable=True)
    bbox_tl_lon = Column(Float, nullable=True)
    bbox_tr_lat = Column(Float, nullable=True)
    bbox_tr_lon = Column(Float, nullable=True)
    bbox_br_lat = Column(Float, nullable=True)
    bbox_br_lon = Column(Float, nullable=True)
    bbox_bl_lat = Column(Float, nullable=True)
    bbox_bl_lon = Column(Float, nullable=True)

    # Relationships
    project = relationship("Project", back_populates="trees")


class DroneProcessingJob(Base):
    __tablename__ = "drone_processing_jobs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, unique=True)
    status = Column(SQLEnum(DroneJobStatus), default=DroneJobStatus.UPLOADING, nullable=False)
    progress = Column(Integer, default=0, nullable=False)
    image_count = Column(Integer, default=0, nullable=False)
    nodeodm_task_uuid = Column(String(255), nullable=True)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)

    # Relationships
    project = relationship("Project", back_populates="drone_job")
