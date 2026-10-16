"""
镜界 JINGJIE · API 路由定义
================================
GET    /api/health                 健康检查
GET    /api/reports                报告列表（分页/性别筛选）
POST   /api/reports               提交分析 → 服务端生成方案并入库
GET    /api/reports/:id           单份报告详情
GET    /api/trend                 评分趋势（供首页折线图）
GET    /api/stats                 汇总统计
POST   /api/analyze               仅生成方案，不入库（试算）
GET    /api/profile               用户档案
PUT    /api/profile               更新档案
"""
import time

from .. import config, db
from ..httpd import HttpError
from ..services import reports


def register(app):
    r = app.router

    @r.get("/api/health")
    def health(req):
        return {
            "ok": True,
            "app": config.APP_NAME,
            "service": config.APP_NAME,
            "version": config.APP_VERSION,
            "time": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "db": "sqlite3",
        }

    @r.get("/api/reports")
    def list_reports(req):
        limit = max(1, min(100, req.q_int("limit", 20)))
        offset = max(0, req.q_int("offset", 0))
        gender = req.q("gender")
        if gender and gender not in ("male", "female"):
            raise HttpError(400, "gender 需为 male 或 female")
        return reports.recent(limit=limit, offset=offset, gender=gender)

    @r.post("/api/reports")
    def create_report(req):
        body = req.json()
        analysis = body.get("analysis")
        if not isinstance(analysis, dict):
            raise HttpError(422, "缺少 analysis 字段，或格式不正确")
        posture = body.get("posture")
        gender = body.get("gender", "male")
        save = body.get("save", True)
        return reports.create(analysis, posture=posture, gender=gender, save=save)

    @r.get("/api/reports/:id")
    def get_report(req):
        try:
            rid = int(req.params["id"])
        except (KeyError, ValueError):
            raise HttpError(400, "报告 id 需为整数")
        row = reports.get(rid)
        if not row:
            raise HttpError(404, f"报告 #{rid} 不存在")
        return row

    @r.get("/api/trend")
    def get_trend(req):
        limit = max(1, min(30, req.q_int("limit", 6)))
        gender = req.q("gender")
        return reports.trend(limit=limit, gender=gender)

    @r.get("/api/stats")
    def get_stats(req):
        return db.stats()

    @r.post("/api/analyze")
    def analyze(req):
        body = req.json()
        analysis = body.get("analysis")
        if not isinstance(analysis, dict):
            raise HttpError(422, "缺少 analysis 字段")
        # 试算不入库
        return reports.create(analysis, posture=body.get("posture"),
                              gender=body.get("gender", "male"), save=False)

    @r.get("/api/profile")
    def get_profile(req):
        p = db.get_profile()
        if not p:
            raise HttpError(404, "档案不存在")
        return p

    @r.put("/api/profile")
    def put_profile(req):
        body = req.json()
        for k in ("nickname", "gender", "goal"):
            if k in body and body[k] is not None and not isinstance(body[k], str):
                raise HttpError(422, f"{k} 需为字符串")
        return db.update_profile(
            nickname=body.get("nickname"),
            gender=body.get("gender"),
            goal=body.get("goal"),
        )
