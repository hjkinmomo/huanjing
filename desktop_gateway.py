from __future__ import annotations

import argparse
import http.client
import json
import mimetypes
import os
import urllib.parse
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Callable


MAX_BODY_BYTES = 1_048_576
MAX_PROVIDER_BODY_BYTES = 24 * 1_048_576
MAX_UPSTREAM_RESPONSE_BYTES = 32 * 1_048_576
UPSTREAM_TIMEOUT_SECONDS = 125


@dataclass(frozen=True)
class GatewayConfig:
    web_root: Path
    bridge_port: int
    token: str
    log: Callable[[str], None] = print

    def __post_init__(self) -> None:
        root = Path(self.web_root).resolve()
        if not root.is_dir():
            raise ValueError("web_root_missing")
        if self.bridge_port < 1024 or self.bridge_port > 65535 or self.bridge_port == 8189:
            raise ValueError("bridge_port_invalid")
        if len(self.token) < 16:
            raise ValueError("gateway_token_invalid")
        object.__setattr__(self, "web_root", root)


def make_gateway_handler(config: GatewayConfig):
    class Handler(BaseHTTPRequestHandler):
        server_version = "HermesDesktopGateway/1.0"

        def log_message(self, _format: str, *_args) -> None:
            return

        def expected_origins(self) -> set[str]:
            port = self.server.server_port
            return {f"http://127.0.0.1:{port}", f"http://localhost:{port}"}

        def valid_host(self) -> bool:
            host = self.headers.get("Host", "").lower()
            port = self.server.server_port
            return host in {f"127.0.0.1:{port}", f"localhost:{port}"}

        def trusted_browser_request(self) -> bool:
            expected = self.expected_origins()
            origin = self.headers.get("Origin", "")
            if origin:
                return origin.rstrip("/") in expected
            referer = self.headers.get("Referer", "")
            if referer:
                parsed = urllib.parse.urlparse(referer)
                return f"{parsed.scheme}://{parsed.netloc}" in expected
            return self.headers.get("Sec-Fetch-Site", "").lower() == "same-origin"

        def send_bytes(self, status: int, body: bytes, content_type: str, *, cache: str = "no-store") -> None:
            path = urllib.parse.urlparse(self.path).path
            try:
                self.send_response(status)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", cache)
                self.send_header("X-Content-Type-Options", "nosniff")
                self.send_header("Referrer-Policy", "no-referrer")
                self.send_header("Cross-Origin-Resource-Policy", "same-origin")
                self.end_headers()
                if self.command != "HEAD" and body:
                    self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                # A cancelled browser request is not an upstream provider failure.
                self.close_connection = True
                config.log(f"gateway: {self.command} {path} client_closed")
                return
            config.log(f"gateway: {self.command} {path} {status}")

        def send_json(self, status: int, payload: dict) -> None:
            body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            self.send_bytes(status, body, "application/json; charset=utf-8")

        def serve_static(self) -> None:
            parsed = urllib.parse.urlparse(self.path)
            try:
                decoded = urllib.parse.unquote(parsed.path, errors="strict")
            except (UnicodeDecodeError, ValueError):
                self.send_json(400, {"error": "invalid_path"})
                return
            if "\x00" in decoded or "\\" in decoded:
                self.send_json(400, {"error": "invalid_path"})
                return
            if decoded == "/":
                relative = "index.html"
            else:
                if decoded.endswith("/"):
                    self.send_json(404, {"error": "not_found"})
                    return
                relative = decoded.lstrip("/")
            candidate = (config.web_root / relative).resolve()
            try:
                candidate.relative_to(config.web_root)
            except ValueError:
                self.send_json(404, {"error": "not_found"})
                return
            if not candidate.is_file():
                self.send_json(404, {"error": "not_found"})
                return
            body = candidate.read_bytes()
            content_type = mimetypes.guess_type(candidate.name)[0] or "application/octet-stream"
            if content_type.startswith("text/") or content_type in {"application/javascript", "application/json"}:
                content_type += "; charset=utf-8"
            self.send_bytes(200, body, content_type, cache="no-store")

        def proxy_api(self) -> None:
            if not self.trusted_browser_request():
                self.send_json(403, {"error": "browser_origin_not_allowed"})
                return
            parsed = urllib.parse.urlparse(self.path)
            body = b""
            if self.command in {"POST", "PUT", "PATCH"}:
                try:
                    length = int(self.headers.get("Content-Length", "0"))
                except ValueError:
                    self.send_json(400, {"error": "invalid_content_length"})
                    return
                limit = MAX_PROVIDER_BODY_BYTES if parsed.path in {"/v1/providers/request", "/v1/agent/tools/execute", "/v1/providers/chat-stream/start", "/v1/agent/runs/execute"} else MAX_BODY_BYTES
                if length <= 0:
                    self.send_json(400, {"error": "invalid_body_size"})
                    return
                if length > limit:
                    self.send_json(413, {"error": "request_too_large"})
                    return
                body = self.rfile.read(length)
                if len(body) != length:
                    self.send_json(400, {"error": "incomplete_body"})
                    return

            headers = {
                "Authorization": f"Bearer {config.token}",
                "Accept": self.headers.get("Accept", "application/json"),
            }
            for name in ("MCP-Protocol-Version", "Mcp-Method", "Mcp-Name"):
                if self.headers.get(name):
                    headers[name] = self.headers[name]
            if body:
                headers["Content-Type"] = self.headers.get("Content-Type", "application/json")
                headers["Content-Length"] = str(len(body))

            connection = http.client.HTTPConnection("127.0.0.1", config.bridge_port, timeout=UPSTREAM_TIMEOUT_SECONDS)
            try:
                connection.request(self.command, self.path, body=body or None, headers=headers)
                response = connection.getresponse()
                response_body = response.read(MAX_UPSTREAM_RESPONSE_BYTES + 1)
                if len(response_body) > MAX_UPSTREAM_RESPONSE_BYTES:
                    self.send_json(502, {"error": "bridge_response_too_large"})
                    return
                content_type = response.getheader("Content-Type") or "application/json; charset=utf-8"
                if parsed.path == "/v1/health" and response.status == 200:
                    try:
                        payload = json.loads(response_body.decode("utf-8"))
                        if not isinstance(payload, dict):
                            raise ValueError("health_shape_invalid")
                        capabilities = payload.get("capabilities") if isinstance(payload.get("capabilities"), dict) else {}
                        payload["capabilities"] = {**capabilities, "desktop_gateway": True}
                        payload["authRequired"] = False
                        payload["browserAuth"] = "same_origin_gateway"
                        response_body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
                        content_type = "application/json; charset=utf-8"
                    except (UnicodeDecodeError, json.JSONDecodeError, ValueError):
                        self.send_json(502, {"error": "bridge_health_invalid"})
                        return
                self.send_bytes(response.status, response_body, content_type)
            except (ConnectionError, OSError, TimeoutError, http.client.HTTPException):
                self.send_json(502, {"error": "bridge_unavailable"})
            finally:
                connection.close()

        def dispatch(self) -> None:
            if not self.valid_host():
                self.send_json(403, {"error": "host_not_allowed"})
                return
            path = urllib.parse.urlparse(self.path).path
            if path.startswith("/v1/"):
                self.proxy_api()
                return
            if self.command not in {"GET", "HEAD"}:
                self.send_json(405, {"error": "method_not_allowed"})
                return
            self.serve_static()

        def do_GET(self) -> None:
            self.dispatch()

        def do_HEAD(self) -> None:
            self.dispatch()

        def do_POST(self) -> None:
            self.dispatch()

        def do_OPTIONS(self) -> None:
            self.dispatch()

    return Handler


def main() -> None:
    parser = argparse.ArgumentParser(description="Hermes same-origin desktop gateway")
    parser.add_argument("--port", type=int, default=8796)
    parser.add_argument("--bridge-port", type=int, default=8797)
    parser.add_argument("--web-root", required=True)
    args = parser.parse_args()
    if args.port < 1024 or args.port > 65535 or args.port in {8189, args.bridge_port}:
        raise SystemExit("gateway_port_invalid")
    token = os.environ.get("HERMES_GATEWAY_TOKEN", "")
    config = GatewayConfig(Path(args.web_root), args.bridge_port, token)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), make_gateway_handler(config))
    print(f"Hermes desktop gateway: http://127.0.0.1:{args.port}", flush=True)
    print(f"Bridge upstream: http://127.0.0.1:{args.bridge_port}", flush=True)
    print(f"Web root: {config.web_root}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
