"""
镜界 JINGJIE · 后端服务配置
================================
集中管理配置项，支持环境变量覆盖。
"""
import os
import pathlib

# ---------- 路径 ----------
BASE_DIR = pathlib.Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
DB_PATH = os.environ.get("JINGJIE_DB", str(DATA_DIR / "jingjie.db"))
STATIC_DIR = BASE_DIR  # 静态资源根目录（前端文件与后端同级）

# ---------- 服务 ----------
HOST = os.environ.get("JINGJIE_HOST", "127.0.0.1")
PORT = int(os.environ.get("JINGJIE_PORT", "8899"))
APP_NAME = "镜界 JINGJIE API"
APP_VERSION = "1.0.0"

# ---------- CORS ----------
# 演示项目放开；生产环境应改为白名单
CORS_ORIGIN = os.environ.get("JINGJIE_CORS", "*")
CORS_METHODS = "GET, POST, PUT, PATCH, DELETE, OPTIONS"
CORS_HEADERS = "Content-Type, Authorization, X-Requested-With"

# ---------- 请求限制 ----------
MAX_BODY_BYTES = 1 * 1024 * 1024   # 1MB
REQUEST_TIMEOUT = 15

# ---------- 日志 ----------
LOG_LEVEL = os.environ.get("JINGJIE_LOG", "INFO")
LOG_FORMAT = "%(asctime)s  %(levelname)-7s %(name)-12s %(message)s"
LOG_DATEFMT = "%H:%M:%S"
