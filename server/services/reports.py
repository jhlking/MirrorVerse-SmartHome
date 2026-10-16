"""
镜界 JINGJIE · 报告服务
================================
编排「保存报告」与「生成方案」的业务逻辑，隔离路由层与数据层。
"""
from .. import db
from ..logger import get
from . import advisor

log = get("reports")


def create(analysis, posture=None, gender="male", save=True):
    """
    接收前端 analysis，服务端生成方案（可选入库）。
    返回 { id, plan, saved }
    """
    plan = advisor.build(analysis, posture, gender)

    tone = analysis.get("tone") or {}
    face = analysis.get("face") or {}
    conf = int((analysis.get("confidence") or tone.get("confidence") or 0) or 0)

    rid = None
    if save:
        rid = db.insert_report(
            gender=plan["gender"],
            score=plan["score"],
            tone_label=(tone.get("label") or plan["tone"]["name"]),
            cool_warm=int(tone.get("coolWarm", 0) or 0),
            face_shape=(face.get("shape") or plan["face"]["shape"]),
            confidence=conf,
            payload=analysis,
            plan=plan,
        )
    return {"id": rid, "plan": plan, "saved": bool(save and rid)}


def get(rid):
    return db.get_report(rid)


def recent(limit=20, offset=0, gender=None):
    rows, total = db.list_reports(limit=limit, offset=offset, gender=gender)
    return {"items": rows, "total": total, "limit": int(limit), "offset": int(offset)}


def trend(limit=6, gender=None):
    rows = db.trend(limit=limit, gender=gender)
    return {
        "points": rows,
        "labels": [(r["created_at"][5:10] if r.get("created_at") else "") for r in rows],
        "scores": [r["score"] for r in rows],
    }
