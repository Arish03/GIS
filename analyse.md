# Plantation & Tree Analytics Dashboard - Full Project Analysis

This document provides a comprehensive analysis of the GIS platform located in `e:\GIS`.

## 1. Executive Summary
The project is an enterprise-grade **GIS (Geographic Information System)** and **Precision Forestry** platform. it automates the processing of raw drone imagery into actionable insights, including tree detection, height measurement, and health analysis. The system is built using a modern microservices architecture, leveraging Docker for orchestration and industry-standard GIS tools.

---

## 2. Technical Architecture

### 2.1 Technology Stack
| Layer | Technologies |
|-------|--------------|
| **Frontend** | React 18, Vite, MapLibre GL JS, Tailwind CSS (implied), Axios |
| **Backend** | FastAPI (Python 3.10+), SQLAlchemy, Pydantic, GeoAlchemy2 |
| **Database** | PostgreSQL 16 + PostGIS 3.4 (Spatial Extensions) |
| **Task Queue** | Celery + Redis |
| **Photogrammetry** | NodeODM (OpenDroneMap) |
| **ML/Analytics** | YOLOv9 (ONNX Runtime), GDAL, Rasterio, NumPy, Shapely |
| **DevOps** | Docker, Docker Compose, Nginx |

### 2.2 Microservices breakdown
The application is composed of 6 primary services defined in `docker-compose.yml`:
1.  **frontend**: Serves the React application. Handles all user interactions and map visualizations.
2.  **backend**: The FastAPI application. Handles API requests, business logic, and metadata management.
3.  **celery-worker**: Processes heavy GIS and ML tasks asynchronously (e.g., photogrammetry, tiling, tree detection).
4.  **nodeodm**: A dedicated service for photogrammetry processing (stitching raw images).
5.  **postgres**: Geospatial database (PostGIS) storing users, projects, and tree geometries.
6.  **redis**: Message broker for communication between the backend and celery workers.

---

## 3. Core Features & Functional Analysis

### 3.1 Drone Image Processing Pipeline
The most complex part of the system is the automated pipeline, triggered upon image upload:
- **Phase 1: Photogrammetry (NodeODM)** -> Generates Orthomosaic (2D map), DSM (Surface Model), and DTM (Terrain Model).
- **Phase 2: Tiling (GDAL)** -> Generates XYZ map tiles (zoom 10-22) for high-performance rendering.
- **Phase 3: AI Tree Detection (YOLOv9)** -> Detects tree crowns from the orthomosaic. Converts pixel coordinates to geographic (lat/long) coordinates.
- **Phase 4: Height Calculation** -> Computes tree height using `CHM = DSM - DTM`.
- **Phase 5: Health Analysis** -> Applies Vegetation Indices (GCC, VARI, etc.) to assess tree vitality.

### 3.2 Advanced Mapping & Visualization
- **Interactive Map**: Uses MapLibre GL JS to overlay raster tiles (ortho, DTM, DSM) and vector data (tree points, field boundaries).
- **Dynamic Vegetation Indices**: Server-side rendering of colored maps based on 12+ indices (NDVI, VARI, etc.) with custom color palettes.
- **Review Panel**: Allows admins to manually correct AI detections (draw/move/resize bounding boxes) and define field boundaries.

### 3.3 Analytics & Reporting
- Detailed dashboards for clients showing tree count, average height, and health distribution.
- Interactive charts (pie, histogram) for visual data summary.

---

## 4. Codebase Structure Analysis

### 4.1 Backend (`/backend/app`)
- `main.py`: Entry point, configures CORS, middleware, and mounts routers.
- `tasks.py`: (**Crucial**) Implementation of the 5-stage Celery processing pipeline.
- `vegetation.py`: Logic for calculating vegetation indices and rendering dynamic tiles.
- `models.py`: Database schema using SQLAlchemy. Includes PostGIS `Geometry` types for spatial data.
- `auth.py`: JWT-based authentication system with role-based access control (Admin, Sub-Admin, Client).

### 4.2 Frontend (`/frontend/src`)
- `components/LayerController.jsx`: Manages map layer switching and VI settings.
- `components/TreeAnnotationPanel.jsx`: Logic for the manual correction tool.
- `pages/admin/ProjectWizard.jsx`: Multi-step UI for creating and processing new projects.
- `contexts/AuthContext.jsx`: Manages global user state and permissions.

### 4.3 Utilities (`/tools`)
- Standalone Python scripts for offline processing or maintenance:
    - `detectv2.py`: Independent tree detection logic.
    - `chm.py`: Raster calculation for height models.
    - `split.py`: Tiling tools for large GeoTIFFs.

---

## 5. Security & Access Control
The platform implements a strict **3-tier Role-Based Access Control (RBAC)**:
- **Admin**: Can manage all users, clients, and projects.
- **Sub-Admin**: Staff accounts with access to specific assigned clients and projects.
- **Client**: View-only access to their own ready-status projects.

---

## 6. Recommendations for Improvement
1.  **Performance**: For very large datasets, consider switching to Vector Tiles for tree detections instead of GeoJSON to improve browser performance.
2.  **Scalability**: The `nodeodm` service is resource-heavy. In a production environment, this should ideally be scaled horizontally or moved to a dedicated high-memory instance.
3.  **Documentation**: Enhance the Swagger documentation (`/api/docs`) with more detailed Pydantic examples for spatial queries.

---
*Analysis generated on: April 16, 2026*
