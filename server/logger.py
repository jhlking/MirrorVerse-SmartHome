"""
镜界 JINGJIE · 日志
================================
统一日志配置：控制台彩色输出 + 统一格式。
"""
import logging
import sys

from . import config

_CONFIGURED = False

# ANSI 颜色（Windows 10+ 终端支持）
_COLORS = {
    "DEBUG": "\033[36m",     # 青
    "INFO": "\033[32m",      # 绿
    "WARNING": "\033[33m",   # 黄
    "ERROR": "\033[31m",     # 红
    "CRITICAL": "\033[41m",  # 红底
}
_RESET = "\033[0m"


class _ColorFormatter(logging.Formatter):
    def format(self, record):
        text = super().format(record)
        color = _COLORS.get(record.levelname, "")
        if color and sys.stderr.isatty():
            return f"{color}{text}{_RESET}"
        return text


def setup():
    """初始化根日志（幂等）。"""
    global _CONFIGURED
    if _CONFIGURED:
        return
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(_ColorFormatter(config.LOG_FORMAT, datefmt=config.LOG_DATEFMT))
    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(getattr(logging, config.LOG_LEVEL.upper(), logging.INFO))
    _CONFIGURED = True


def get(name):
    setup()
    return logging.getLogger(name)
