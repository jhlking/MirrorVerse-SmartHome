"""
镜界 JINGJIE · 数据层
================================
基于 sqlite3 的轻量持久化。含建表、迁移、连接管理。
表结构：
  reports  —— 每次检测的体态/肤色分析结果与建议快照
  profile  —— 用户档案（昵称 / 性别 / 目标）
"""
import json
import sqlite3
import threading
import time
import pathlib

from . import config
from .logger import get

log = get("db")

_local = threading.local()
_SCHEMA_VERSION = 1

SCHEMA = """
CREATE TABLE IF NOT EXISTS reports (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at    TEXT    NOT NULL,
    gender        TEXT    NOT NULL DEFAULT 'male',
    score         INTEGER,
    tone_label    TEXT,
    cool_warm     INTEGER,
    face_shape    TEXT,
    confidence    INTEGER,
    payload       TEXT    NOT NULL,     -- 完整分析 JSON
    plan          TEXT                  -- 服务端生成的建议方案 JSON
);

CREATE INDEX IF NOT EXISTS idx_reports_created ON reports(created_at DESC);

CREATE TABLE IF NOT EXISTS profile (
    id            INTEGER PRIMARY KEY CHECK (id = 1),   -- 单行表
    nickname      TEXT    NOT NULL DEFAULT '访客',
    gender        TEXT    NOT NULL DEFAULT 'male',
    goal          TEXT    NOT NULL DEFAULT '',
    updated_at    TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
);
"""


def _conn():
    """每线程一个连接（sqlite3 连接不可跨线程共享）。"""
    c = getattr(_local, "conn", None)
    if c is None:
        pathlib.Path(config.DB_PATH).parent.mkdir(parents=True, exist_ok=True)
        c = sqlite3.connect(config.DB_PATH, timeout=config.REQUEST_TIMEOUT)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA journal_mode=WAL")
        c.execute("PRAGMA foreign_keys=ON")
        _local.conn = c
    return c


def init():
    """建表 + 版本迁移 + 种子数据。"""
    c = _conn()
    c.executescript(SCHEMA)
    c.commit()

    # 版本记录与迁移入口
    cur = c.execute("SELECT value FROM meta WHERE key='schema_version'").fetchone()
    current = int(cur["value"]) if cur else 0
    if current < _SCHEMA_VERSION:
        _migrate(c, current)
        c.execute("INSERT OR REPLACE INTO meta(key,value) VALUES('schema_version',?)",
                  (str(_SCHEMA_VERSION),))
        c.commit()
        log.info("数据库结构版本 %s -> %s", current, _SCHEMA_VERSION)

    # 单行档案表：确保存在
    if not c.execute("SELECT 1 FROM profile WHERE id=1").fetchone():
        c.execute("INSERT INTO profile(id,nickname,gender,goal,updated_at) VALUES(1,?,?,?,?)",
                  ("访客", "male", "", _now()))
        c.commit()
        log.info("初始化默认用户档案")

    log.info("数据库就绪：%s", config.DB_PATH)


def _migrate(c, from_ver):
    """预留迁移位；当前仅 0 -> 1 的建表。"""
    if from_ver == 0:
        log.info("首次建库，跳过增量迁移")


def _now():
    return time.strftime("%Y-%m-%dT%H:%M:%S")


# ---------------- reports ----------------

def insert_report(gender, score, tone_label, cool_warm, face_shape,
                  confidence, payload, plan):
    c = _conn()
    cur = c.execute(
        """INSERT INTO reports
           (created_at, gender, score, tone_label, cool_warm, face_shape,
            confidence, payload, plan)
           VALUES (?,?,?,?,?,?,?,?,?)""",
        (_now(), gender, score, tone_label, cool_warm, face_shape,
         confidence, json.dumps(payload, ensure_ascii=False),
         json.dumps(plan, ensure_ascii=False) if plan else None)
    )
    c.commit()
    rid = cur.lastrowid
    log.info("保存报告 #%s (gender=%s score=%s)", rid, gender, score)
    return rid


def list_reports(limit=20, offset=0, gender=None):
    c = _conn()
    sql = "SELECT id, created_at, gender, score, tone_label, cool_warm, face_shape, confidence FROM reports"
    args = []
    if gender:
        sql += " WHERE gender=?"
        args.append(gender)
    sql += " ORDER BY id DESC LIMIT ? OFFSET ?"
    args += [int(limit), int(offset)]
    rows = [dict(r) for r in c.execute(sql, args).fetchall()]
    total = c.execute("SELECT COUNT(*) n FROM reports" + (" WHERE gender=?" if gender else ""),
                      args[:1] if gender else []).fetchone()["n"]
    return rows, total


def get_report(rid):
    c = _conn()
    r = c.execute("SELECT * FROM reports WHERE id=?", (rid,)).fetchone()
    if not r:
        return None
    d = dict(r)
    d["payload"] = json.loads(d["payload"]) if d["payload"] else None
    d["plan"] = json.loads(d["plan"]) if d["plan"] else None
    return d


def trend(limit=6, gender=None):
    """返回最近 N 次的评分序列（时间正序，便于画折线）。"""
    c = _conn()
    sql = "SELECT id, created_at, score, tone_label FROM reports"
    args = []
    if gender:
        sql += " WHERE gender=?"
        args.append(gender)
    sql += " ORDER BY id DESC LIMIT ?"
    args.append(int(limit))
    rows = [dict(r) for r in c.execute(sql, args).fetchall()]
    return list(reversed(rows))


def stats():
    c = _conn()
    n = c.execute("SELECT COUNT(*) n FROM reports").fetchone()["n"]
    avg = c.execute("SELECT AVG(score) a FROM reports").fetchone()["a"]
    latest = c.execute("SELECT score FROM reports ORDER BY id DESC LIMIT 1").fetchone()
    return {
        "count": n,
        "avgScore": round(avg, 1) if avg is not None else None,
        "latestScore": latest["score"] if latest else None,
    }


# ---------------- profile ----------------

def get_profile():
    c = _conn()
    r = c.execute("SELECT * FROM profile WHERE id=1").fetchone()
    return dict(r) if r else None


def update_profile(nickname=None, gender=None, goal=None):
    c = _conn()
    fields, args = [], []
    if nickname is not None:
        fields.append("nickname=?"); args.append(str(nickname)[:32])
    if gender is not None:
        fields.append("gender=?"); args.append("female" if gender == "female" else "male")
    if goal is not None:
        fields.append("goal=?"); args.append(str(goal)[:120])
    if not fields:
        return get_profile()
    fields.append("updated_at=?"); args.append(_now())
    c.execute(f"UPDATE profile SET {', '.join(fields)} WHERE id=1", args)
    c.commit()
    log.info("更新档案：%s", ", ".join(f.split("=")[0] for f in fields if f != "updated_at=?"))
    return get_profile()


def close():
    c = getattr(_local, "conn", None)
    if c:
        c.close()
        _local.conn = None
