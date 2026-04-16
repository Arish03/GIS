import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.database import engine, Base
from app.config import get_settings
from app.routers import auth, users, projects, trees, upload
from app.routers.vegetation import router as vegetation_router

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: wait for DB and create tables
    import time
    from sqlalchemy.exc import OperationalError

    max_retries = 10
    retry_interval = 3
    connected = False

    print("Checking database connection...")
    for i in range(max_retries):
        try:
            Base.metadata.create_all(bind=engine)
            connected = True
            print("Database connected and tables verified.")
            break
        except OperationalError as e:
            print(f"Database not ready (attempt {i+1}/{max_retries}): {e}")
            time.sleep(retry_interval)

    if not connected:
        print("Could not connect to database after multiple retries. Exiting.")
        raise RuntimeError("Database connection failed")

    # Auto-seed default users
    from app.seed import seed
    try:
        seed()
    except Exception as e:
        print(f"Seed warning: {e}")

    yield


app = FastAPI(
    title="Plantation & Tree Analytics Dashboard",
    description="GIS-powered plantation management and analytics platform",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount routers
app.include_router(auth.router)
app.include_router(users.router)
app.include_router(projects.router)
app.include_router(trees.router)
app.include_router(upload.router)
app.include_router(vegetation_router)

# Serve generated tiles as static files (AFTER dynamic routes so /tiles/{id}/vi/ takes priority)
tiles_dir = settings.TILES_DIR
os.makedirs(tiles_dir, exist_ok=True)
app.mount("/tiles", StaticFiles(directory=tiles_dir), name="tiles")


@app.get("/api/health")
def health_check():
    return {"status": "ok", "service": "plantation-api"}
