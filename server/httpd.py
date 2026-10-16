"""
镜界 JINGJIE · 极简 HTTP 框架
================================
基于标准库 http.server，提供：
  - 装饰器路由（@get / @post / @put / @delete）
  - 路径参数（/api/reports/:id）
  - 统一 JSON 响应与错误处理
  - CORS
  - 静态文件服务（含正确的 MIME）
"""
import json
import mimetypes
import pathlib
import re
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs, unquote

from . import config
from .logger import get

log = get("http")
access = get("access")


class HttpError(Exception):
    """业务异常：携带状态码与错误码。"""
    def __init__(self, status, message, code=None):
        super().__init__(message)
        self.status = status
        self.message = message
        self.code = code or _default_code(status)


def _default_code(status):
    return {
        400: "BAD_REQUEST", 401: "UNAUTHORIZED", 403: "FORBIDDEN",
        404: "NOT_FOUND", 405: "METHOD_NOT_ALLOWED", 409: "CONFLICT",
        422: "UNPROCESSABLE", 500: "INTERNAL_ERROR",
    }.get(status, "ERROR")


class Request:
    def __init__(self, method, path, query, headers, body, params=None):
        self.method = method
        self.path = path
        self.query = query
        self.headers = headers
        self.body = body            # bytes
        self.params = params or {}  # 路径参数

    def json(self, default=None):
        """解析 JSON body；空体返回 default。"""
        if not self.body:
            return default if default is not None else {}
        try:
            return json.loads(self.body.decode("utf-8"))
        except (ValueError, UnicodeDecodeError) as e:
            raise HttpError(400, f"请求体不是合法 JSON：{e}")

    def q(self, key, default=None):
        v = self.query.get(key)
        return v[0] if v else default

    def q_int(self, key, default):
        v = self.q(key)
        try:
            return int(v) if v is not None else default
        except (TypeError, ValueError):
            raise HttpError(400, f"参数 {key} 需为整数")


class Response:
    def __init__(self, data=None, status=200, headers=None):
        self.data = data
        self.status = status
        self.headers = headers or {}


class Router:
    def __init__(self):
        self.routes = []   # (method, regex, handler)

    def _add(self, method, pattern, handler):
        # /api/reports/:id -> ^/api/reports/(?P<id>[^/]+)$
        regex = re.sub(r":([a-zA-Z_]\w*)", r"(?P<\1>[^/]+)", pattern)
        self.routes.append((method, re.compile("^" + regex + "$"), handler))

    def get(self, p):    return lambda f: (self._add("GET", p, f), f)[1]
    def post(self, p):   return lambda f: (self._add("POST", p, f), f)[1]
    def put(self, p):    return lambda f: (self._add("PUT", p, f), f)[1]
    def patch(self, p):  return lambda f: (self._add("PATCH", p, f), f)[1]
    def delete(self, p): return lambda f: (self._add("DELETE", p, f), f)[1]

    def match(self, method, path):
        path_matched = False
        for m, rx, handler in self.routes:
            mt = rx.match(path)
            if not mt:
                continue
            path_matched = True
            if m == method:
                return handler, mt.groupdict()
        if path_matched:
            raise HttpError(405, f"{method} 不被 {path} 支持")
        return None, None


class App:
    def __init__(self):
        self.router = Router()
        self.static_root = pathlib.Path(config.STATIC_DIR)

    # ---- 静态文件 ----
    def _serve_static(self, handler, path):
        rel = unquote(path.lstrip("/")) or "index.html"
        target = (self.static_root / rel).resolve()
        # 目录穿越防护
        if not str(target).startswith(str(self.static_root.resolve())):
            raise HttpError(403, "禁止访问")
        if target.is_dir():
            target = target / "index.html"
        if not target.exists():
            raise HttpError(404, f"文件不存在：{rel}")
        ctype, _ = mimetypes.guess_type(str(target))
        data = target.read_bytes()
        handler.send_response(200)
        handler.send_header("Content-Type", ctype or "application/octet-stream")
        handler.send_header("Content-Length", str(len(data)))
        handler.send_header("Cache-Control", "no-cache")
        self._cors(handler)
        handler.end_headers()
        handler.wfile.write(data)

    def _cors(self, handler):
        handler.send_header("Access-Control-Allow-Origin", config.CORS_ORIGIN)
        handler.send_header("Access-Control-Allow-Methods", config.CORS_METHODS)
        handler.send_header("Access-Control-Allow-Headers", config.CORS_HEADERS)

    def handle(self, handler, method):
        t0 = time.time()
        parsed = urlparse(handler.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        try:
            if path.startswith("/api/"):
                fn, params = self.router.match(method, path.rstrip("/") or path)
                if fn is None:
                    raise HttpError(404, f"接口不存在：{path}")
                length = int(handler.headers.get("Content-Length") or 0)
                if length > config.MAX_BODY_BYTES:
                    raise HttpError(413, "请求体过大")
                body = handler.rfile.read(length) if length else b""
                req = Request(method, path, query, handler.headers, body, params)
                result = fn(req)
                if isinstance(result, Response):
                    self._json(handler, result.data, result.status, result.headers)
                else:
                    self._json(handler, result, 200)
            else:
                if method != "GET":
                    raise HttpError(405, "静态资源仅支持 GET")
                self._serve_static(handler, path)

        except HttpError as e:
            log.warning("%s %s -> %s %s", method, path, e.status, e.message)
            self._json(handler, {"error": {"code": e.code, "message": e.message},
                                 "status": e.status}, e.status)
        except BrokenPipeError:
            pass
        except Exception as e:                      # noqa: BLE001
            log.error("未捕获异常 %s %s: %s", method, path, e)
            log.debug("%s", traceback.format_exc())
            self._json(handler, {"error": {"code": "INTERNAL_ERROR",
                                           "message": "服务端内部错误"}}, 500)
        finally:
            ms = (time.time() - t0) * 1000
            access.info("%-6s %-38s %6.1fms", method, path[:38], ms)

    def _json(self, handler, data, status=200, headers=None):
        payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
        handler.send_response(status)
        handler.send_header("Content-Type", "application/json; charset=utf-8")
        handler.send_header("Content-Length", str(len(payload)))
        for k, v in (headers or {}).items():
            handler.send_header(k, v)
        self._cors(handler)
        handler.end_headers()
        handler.wfile.write(payload)


class Handler(BaseHTTPRequestHandler):
    app = None
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):    # 静音默认 stderr 日志（我们用 access 日志）
        pass

    def _dispatch(self, method):
        self.app.handle(self, method)

    def do_GET(self):     self._dispatch("GET")
    def do_POST(self):    self._dispatch("POST")
    def do_PUT(self):     self._dispatch("PUT")
    def do_PATCH(self):   self._dispatch("PATCH")
    def do_DELETE(self):  self._dispatch("DELETE")

    def do_OPTIONS(self):
        self.send_response(204)
        self.app._cors(self)
        self.send_header("Content-Length", "0")
        self.end_headers()


def make_server(app):
    Handler.app = app
    srv = ThreadingHTTPServer((config.HOST, config.PORT), Handler)
    srv.daemon_threads = True
    return srv
