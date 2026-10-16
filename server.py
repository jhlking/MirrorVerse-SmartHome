#!/usr/bin/env python3
"""
镜界 JINGJIE · 后端服务入口
================================
零依赖：仅使用 Python 标准库（http.server + sqlite3）。

用法：
    python server.py                 # 默认 127.0.0.1:8899
    python server.py --port 9000     # 指定端口
    python server.py --host 0.0.0.0  # 允许局域网访问
    python server.py --reset         # 清空数据库后启动

启动后：
    前端       http://127.0.0.1:8899/
    API 文档   http://127.0.0.1:8899/api/health
"""
import argparse
import os
import signal
import sys
import threading
import time
import webbrowser
from pathlib import Path

# 允许以脚本方式直接运行（python server.py）
sys.path.insert(0, str(Path(__file__).resolve().parent))

from server import config, db          # noqa: E402
from server.httpd import App, make_server   # noqa: E402
from server.logger import setup, get   # noqa: E402
from server.routes import api          # noqa: E402

log = get("main")

BANNER = r"""
   ___  _                     _  _
  |_ _|(_) _ __    __ _   ___ (_)| | ___
   | | | || '_ \  / _` | / _ \| || |/ _ \
   | | | || | | || (_| ||  __/| || |  __/
  |___||_||_| |_| \__, | \___||_||_|\___|
                  |___/   镜界 · AI 智美形象管家
"""


def parse_args():
    p = argparse.ArgumentParser(description="镜界 JINGJIE 后端服务")
    p.add_argument("--host", default=config.HOST, help="监听地址")
    p.add_argument("--port", type=int, default=config.PORT, help="监听端口")
    p.add_argument("--reset", action="store_true", help="清空数据库后启动")
    p.add_argument("--no-browser", action="store_true", help="不自动打开浏览器")
    p.add_argument("--seed", action="store_true", help="写入演示数据（首次体验用）")
    return p.parse_args()


def seed_demo_data():
    """写入几条演示报告，让首页趋势图立刻有内容。"""
    from server.services import reports
    samples = [
        ({"tone": {"rgb": [206, 178, 162], "lightness": 172, "saturation": 30,
                   "hue": 26, "coolWarm": 14, "label": "暖调", "pixels": 21600},
          "face": {"shape": "鹅蛋脸", "ratio": 1.32},
          "quality": {"brightness": 156, "contrast": 42, "sharpness": 14.2,
                      "issues": []}, "confidence": 94}, "female"),
        ({"tone": {"rgb": [196, 153, 125], "lightness": 158, "saturation": 28,
                   "hue": 24, "coolWarm": 13, "label": "暖调", "pixels": 20640},
          "face": {"shape": "长形脸", "ratio": 1.46},
          "quality": {"brightness": 150, "contrast": 40, "sharpness": 12.0,
                      "issues": []}, "confidence": 96}, "male"),
        ({"tone": {"rgb": [198, 190, 186], "lightness": 182, "saturation": 18,
                   "hue": 20, "coolWarm": -6, "label": "中性调", "pixels": 18900},
          "face": {"shape": "圆脸", "ratio": 1.12},
          "quality": {"brightness": 168, "contrast": 34, "sharpness": 9.4,
                      "issues": ["对比度偏低"]}, "confidence": 88}, "female"),
    ]
    posture = {"targets": ["forward_head", "shoulder"], "penalty": 5}
    for a, g in samples:
        reports.create(a, posture=posture, gender=g)
    log.info("已写入 %d 条演示数据", len(samples))


def main():
    args = parse_args()
    config.HOST, config.PORT = args.host, args.port

    setup()
    print(BANNER)

    if args.reset and os.path.exists(config.DB_PATH):
        os.remove(config.DB_PATH)
        for suffix in ("-wal", "-shm"):
            p = config.DB_PATH + suffix
            if os.path.exists(p):
                os.remove(p)
        log.info("已重置数据库")

    db.init()

    app = App()
    api.register(app)

    if args.seed:
        seed_demo_data()

    srv = make_server(app)
    url = f"http://{args.host}:{args.port}/"

    log.info("服务已启动：%s", url)
    log.info("接口自检：%sapi/health", url)
    log.info("按 Ctrl+C 停止")

    if not args.no_browser:
        threading.Timer(1.2, lambda: webbrowser.open(url)).start()

    stopping = threading.Event()

    def shutdown(signum, frame):
        if stopping.is_set():
            return
        stopping.set()
        log.info("收到退出信号，正在关闭…")
        threading.Thread(target=srv.shutdown, daemon=True).start()

    try:
        signal.signal(signal.SIGINT, shutdown)
        signal.signal(signal.SIGTERM, shutdown)
    except (ValueError, AttributeError):
        pass

    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()
        db.close()
        log.info("服务已停止，再见 👋")
        print()


if __name__ == "__main__":
    main()
