from pydantic_settings import BaseSettings
from functools import lru_cache
import os


class Settings(BaseSettings):
    POSTGRES_DB: str
    POSTGRES_USER: str
    POSTGRES_PASSWORD: str
    DATABASE_URL: str
    REDIS_URL: str
    JWT_SECRET: str
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRATION_HOURS: int = 24
    UPLOAD_DIR: str = os.path.join(os.path.dirname(os.path.dirname(__file__)), "uploads")
    TILES_DIR: str = os.path.join(os.path.dirname(os.path.dirname(__file__)), "tiles")
    NODEODM_URL: str
    YOLO_MODEL_PATH: str = "/app/models/yolov9_trees.onnx"

    class Config:
        env_file = ".env"


@lru_cache()
def get_settings() -> Settings:
    return Settings()
