"""Local, approval-gated Windows control bridge for Hermes Project 5.

The bridge binds to loopback only, requires a bearer token for every action,
and keeps filesystem and command access behind explicit startup allowlists.
"""

from __future__ import annotations

import argparse
import ctypes
import json
import os
import secrets
import shutil
import subprocess
import sys
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from agent_runtime import AgentRuntime
from credential_runtime import CredentialVault
from provider_stream import ChatStreams
from agent_protocols import AgentProtocols, rpc_error, parse_json_message


MAX_BODY_BYTES = 1_048_576
MAX_PROVIDER_BODY_BYTES = 24 * 1_048_576
OBSERVE_ACTIONS = {"screen_capture", "read_text_file"}


def resolved_roots(values: list[str]) -> list[Path]:
    roots = [Path(value).expanduser().resolve() for value in values]
    return list(dict.fromkeys(roots))


def safe_path(raw: str, roots: list[Path]) -> Path:
    candidate = Path(raw).expanduser().resolve()
    if not any(candidate == root or root in candidate.parents for root in roots):
        raise PermissionError("path_outside_allowlist")
    return candidate


def json_result(value: Any) -> Any:
    if isinstance(value, Path):
        return str(value)
    return value


class Bridge:
    def __init__(
        self,
        token: str,
        roots: list[Path],
        allowed_commands: set[str],
        agent_runtime: AgentRuntime | None = None,
        credential_vault: CredentialVault | None = None,
    ) -> None:
        self.token = token
        self.roots = roots
        self.allowed_commands = {command.lower() for command in allowed_commands}
        self.git_path = shutil.which("git")
        self.rg_path = shutil.which("rg")
        self.agent_protocols = AgentProtocols(agent_runtime) if agent_runtime else None
        self.agent_runtime = agent_runtime
        self.chat_streams = ChatStreams(agent_runtime) if agent_runtime else None
        self.credential_vault = credential_vault
        if agent_runtime:
            agent_runtime.auto_moments.resolve_provider = lambda provider: self.resolve_provider_credential(provider, "chat")
            agent_runtime.role_workspace.resolve_provider = lambda provider: self.resolve_provider_credential(provider, "chat")
            agent_runtime.world_life.weekly.resolve_provider = lambda mode,config: self.resolve_provider_credential({"endpoint":config["endpoint"],"model":config["model"],"credentialId":agent_runtime.world_life.weekly.slot(mode)},agent_runtime.world_life.weekly.slot(mode))
        self.sync_extension_credentials()
        try:
            from PIL import ImageGrab  # type: ignore

            self.image_grab = ImageGrab
        except ImportError:
            self.image_grab = None

    @property
    def capabilities(self) -> dict[str, bool]:
        return {
            "screen_capture": self.image_grab is not None,
            "open_url": True,
            "open_path": True,
            "read_text_file": True,
            "write_text_file": True,
            "mouse_move": sys.platform == "win32",
            "mouse_click": sys.platform == "win32",
            "type_text": sys.platform == "win32",
            "key_press": sys.platform == "win32",
            "run_command": bool(self.allowed_commands),
            "run_diagnostic": bool(self.git_path or self.rg_path),
            "mcp": self.agent_protocols is not None,
            "agent_runtime": self.agent_runtime is not None,
            "provider_proxy": self.agent_runtime is not None,
            "credential_vault": bool(self.credential_vault and self.credential_vault.available),
        }

    def sync_extension_credentials(self) -> None:
        if not self.credential_vault:
            return
        definitions = self.agent_runtime.extension_credential_definitions() if self.agent_runtime else {}
        role_definitions = self.agent_runtime.role_workspace.credential_definitions() if self.agent_runtime else {}
        definitions.update(role_definitions)
        if self.agent_runtime:definitions.update(self.agent_runtime.world_life.weekly.credential_definitions())
        self.credential_vault.replace_extension_slots(definitions)
        self.credential_vault.migrate_role_slots(list(role_definitions))

    def resolve_provider_credential(self, provider: dict[str, Any], expected_slot: str, role_id: str = '') -> dict[str, Any]:
        resolved = dict(provider)
        role_id = role_id or str(resolved.pop('roleId', '') or '')
        if role_id and role_id != 'shared' and expected_slot == 'chat' and self.agent_runtime:
            self.agent_runtime.role_workspace.ensure_agent(role_id)
            self.sync_extension_credentials()
            expected_slot = self.agent_runtime.role_workspace.credential_slot(role_id)
        credential_id = str(resolved.get("credentialId") or "").strip().lower()
        # Existing character clients using the old slot are routed to their private copy.
        if expected_slot.startswith('ext.role-agent.') and credential_id == 'chat':credential_id=expected_slot
        if credential_id and credential_id != expected_slot:
            raise ValueError("credential_slot_mismatch")
        if credential_id:
            if not self.credential_vault:
                raise RuntimeError("credential_vault_unavailable")
            resolved["apiKey"] = self.credential_vault.resolve(credential_id)
        resolved.pop("credentialId", None)
        return resolved

    def resolve_agent_credentials(self, payload: dict[str, Any]) -> dict[str, Any]:
        resolved = dict(payload)
        if isinstance(payload.get("provider"), dict):
            resolved["provider"] = self.resolve_provider_credential(payload["provider"], "chat", str(payload.get('roleId') or ''))
        if isinstance(payload.get("searchProvider"), dict):
            resolved["searchProvider"] = self.resolve_provider_credential(payload["searchProvider"], "search")
        return resolved

    def execute(self, action_type: str, args: dict[str, Any], policy: str) -> dict[str, Any]:
        if policy == "observe_only" and action_type not in OBSERVE_ACTIONS:
            raise PermissionError("observe_only_policy")
        if not self.capabilities.get(action_type, False):
            raise RuntimeError("capability_unavailable")

        handler = getattr(self, f"action_{action_type}", None)
        if handler is None:
            raise ValueError("unknown_action")
        return {"ok": True, "type": action_type, "result": json_result(handler(args))}

    def execute_approved_proposal(self, action_type: str, args: dict[str, Any]) -> dict[str, Any]:
        if action_type == "mcp_tool_call":
            if not self.agent_runtime:
                raise RuntimeError("agent_runtime_unavailable")
            return self.agent_runtime.remote_mcp.execute_snapshot(args)
        if action_type.startswith("office_create_"):
            if not self.agent_runtime:
                raise RuntimeError("agent_runtime_unavailable")
            return self.agent_runtime.registry.dispatch(action_type, args)
        return self.execute(action_type, args, "ask_every_time")

    def action_screen_capture(self, args: dict[str, Any]) -> dict[str, Any]:
        output = safe_path(str(args.get("path") or self.roots[0] / "hermes-screen.png"), self.roots)
        output.parent.mkdir(parents=True, exist_ok=True)
        image = self.image_grab.grab(all_screens=True)
        image.save(output, "PNG")
        return {"path": str(output), "width": image.width, "height": image.height}

    def action_open_url(self, args: dict[str, Any]) -> dict[str, Any]:
        url = str(args.get("url") or "").strip()
        parsed = urllib.parse.urlparse(url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError("invalid_http_url")
        os.startfile(url)  # type: ignore[attr-defined]
        return {"url": url}

    def action_open_path(self, args: dict[str, Any]) -> dict[str, Any]:
        path = safe_path(str(args.get("path") or ""), self.roots)
        if not path.exists():
            raise FileNotFoundError("path_not_found")
        os.startfile(path)  # type: ignore[attr-defined]
        return {"path": str(path)}

    def action_read_text_file(self, args: dict[str, Any]) -> dict[str, Any]:
        path = safe_path(str(args.get("path") or ""), self.roots)
        if not path.is_file():
            raise FileNotFoundError("file_not_found")
        if path.stat().st_size > MAX_BODY_BYTES:
            raise ValueError("file_too_large")
        return {"path": str(path), "text": path.read_text(encoding="utf-8")}

    def action_write_text_file(self, args: dict[str, Any]) -> dict[str, Any]:
        path = safe_path(str(args.get("path") or ""), self.roots)
        text = str(args.get("text") or "")
        if len(text.encode("utf-8")) > MAX_BODY_BYTES:
            raise ValueError("text_too_large")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        return {"path": str(path), "bytes": len(text.encode("utf-8"))}

    def action_mouse_move(self, args: dict[str, Any]) -> dict[str, Any]:
        x, y = int(args.get("x")), int(args.get("y"))
        if not ctypes.windll.user32.SetCursorPos(x, y):
            raise RuntimeError("mouse_move_failed")
        return {"x": x, "y": y}

    def action_mouse_click(self, args: dict[str, Any]) -> dict[str, Any]:
        button = str(args.get("button") or "left").lower()
        flags = {"left": (0x0002, 0x0004), "right": (0x0008, 0x0010)}.get(button)
        if flags is None:
            raise ValueError("unsupported_mouse_button")
        ctypes.windll.user32.mouse_event(flags[0], 0, 0, 0, 0)
        ctypes.windll.user32.mouse_event(flags[1], 0, 0, 0, 0)
        return {"button": button}

    def action_type_text(self, args: dict[str, Any]) -> dict[str, Any]:
        text = str(args.get("text") or "")
        for char in text:
            ctypes.windll.user32.VkKeyScanW(ord(char))
            ctypes.windll.user32.SendMessageW(ctypes.windll.user32.GetForegroundWindow(), 0x0102, ord(char), 0)
        return {"characters": len(text)}

    def action_key_press(self, args: dict[str, Any]) -> dict[str, Any]:
        key = str(args.get("key") or "").upper()
        virtual_keys = {"ENTER": 0x0D, "ESCAPE": 0x1B, "TAB": 0x09, "SPACE": 0x20}
        code = virtual_keys.get(key)
        if code is None and len(key) == 1:
            code = ord(key)
        if code is None:
            raise ValueError("unsupported_key")
        ctypes.windll.user32.keybd_event(code, 0, 0, 0)
        ctypes.windll.user32.keybd_event(code, 0, 0x0002, 0)
        return {"key": key}

    def action_run_command(self, args: dict[str, Any]) -> dict[str, Any]:
        command = str(args.get("command") or "").strip()
        command_name = Path(command).name.lower()
        if command_name not in self.allowed_commands:
            raise PermissionError("command_not_allowlisted")
        command_args = args.get("args") or []
        if not isinstance(command_args, list) or not all(isinstance(item, str) for item in command_args):
            raise ValueError("invalid_command_args")
        completed = subprocess.run(
            [command, *command_args],
            cwd=self.roots[0],
            shell=False,
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
        return {
            "exitCode": completed.returncode,
            "stdout": completed.stdout[-12000:],
            "stderr": completed.stderr[-12000:],
        }

    def action_run_diagnostic(self, args: dict[str, Any]) -> dict[str, Any]:
        template = str(args.get("template") or "").strip().lower()
        target = safe_path(str(args.get("path") or self.roots[0]), self.roots)
        if not target.is_dir():
            raise FileNotFoundError("diagnostic_directory_not_found")
        limit = max(1, min(100, int(args.get("limit") or 20)))
        if template == "text_search":
            query = str(args.get("query") or "").strip()
            if not query or len(query) > 200 or "\n" in query or "\r" in query:
                raise ValueError("diagnostic_query_invalid")
            if not self.rg_path:
                raise RuntimeError("diagnostic_rg_unavailable")
            command = [self.rg_path, "--line-number", "--no-heading", "--max-count", str(limit), "--", query, str(target)]
        elif template in {"git_status", "git_diff_summary", "git_log"}:
            if not self.git_path:
                raise RuntimeError("diagnostic_git_unavailable")
            git_templates = {
                "git_status": ["status", "--short", "--branch"],
                "git_diff_summary": ["diff", "--stat", "--"],
                "git_log": ["log", f"-{limit}", "--oneline", "--decorate"],
            }
            command = [self.git_path, "-C", str(target), *git_templates[template]]
        else:
            raise ValueError("diagnostic_template_not_allowed")
        completed = subprocess.run(
            command,
            cwd=target,
            shell=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=20,
            check=False,
        )
        return {
            "template": template,
            "path": str(target),
            "exitCode": completed.returncode,
            "stdout": completed.stdout[-12000:],
            "stderr": completed.stderr[-12000:],
            "truncated": len(completed.stdout) > 12000 or len(completed.stderr) > 12000,
        }


def make_handler(bridge: Bridge):
    class Handler(BaseHTTPRequestHandler):
        server_version = "HermesLocalBridge/1.0"

        def log_message(self, format_string: str, *args: Any) -> None:
            sys.stdout.write("bridge: " + (format_string % args) + "\n")

        def cors_origin(self) -> str | None:
            origin = self.headers.get("Origin", "")
            parsed = urllib.parse.urlparse(origin)
            if (parsed.scheme in {"http", "https"} and parsed.hostname in {"127.0.0.1", "localhost", "::1"}
                    and not parsed.username and not parsed.password and not parsed.query and not parsed.fragment
                    and parsed.path in {"", "/"}):
                return origin
            return None

        def send_json(self, status: int, payload: dict[str, Any]) -> None:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            origin = self.cors_origin()
            if origin:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept, MCP-Protocol-Version, Mcp-Method, Mcp-Name")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.end_headers()
            self.wfile.write(body)

        def authorized(self) -> bool:
            return secrets.compare_digest(self.headers.get("Authorization", ""), f"Bearer {bridge.token}")

        def reject_post(self, status: int, payload: dict[str, Any]) -> None:
            # Closing with an unread small POST body can reset the connection on
            # Windows before the client receives our 401/404 JSON. Discard bounded
            # input without parsing it or touching runtime state. Oversized/slow
            # unauthorized bodies never get an unbounded read.
            previous_timeout = self.connection.gettimeout()
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if 0 < length <= 65_536:
                    self.connection.settimeout(0.25)
                    self.rfile.read(length)
            except (ValueError, OSError):
                pass
            finally:
                self.connection.settimeout(previous_timeout)
            self.send_json(status, payload)

        def do_OPTIONS(self) -> None:
            if not self.cors_origin():
                self.send_json(403, {"error": "origin_not_allowed"})
                return
            self.send_json(204, {})

        def do_GET(self) -> None:
            parsed_path = urllib.parse.urlparse(self.path)
            if parsed_path.path == "/v1/mcp":
                if self.headers.get("Origin") and not self.cors_origin():
                    self.send_json(403, {"error": "origin_not_allowed"}); return
                self.send_json(405 if self.authorized() else 401, {"error": "method_not_allowed" if self.authorized() else "invalid_token"}); return
            if parsed_path.path == "/v1/health":
                runtime_status = bridge.agent_runtime.status() if bridge.agent_runtime else None
                self.send_json(200, {
                    "ok": True,
                    "service": "hermes-local-bridge",
                    "authRequired": True,
                    "capabilities": bridge.capabilities,
                    "allowedRoots": [str(root) for root in bridge.roots],
                    "agent": {
                        "available": True,
                        "schemaVersion": runtime_status["schemaVersion"],
                        "scheduler": runtime_status["scheduler"],
                        "toolCount": len(runtime_status["tools"]),
                    } if runtime_status else None,
                })
                return
            if parsed_path.path not in {"/v1/agent/status", "/v1/agent/events", "/v1/agent/runs/status", "/v1/agent/approvals", "/v1/providers/acceptance", "/v1/credentials/status", "/v1/providers/chat-stream/status", "/v1/providers/reasoning-translate/status", "/v1/agent/capabilities", "/v1/agent/openapi.json", "/v1/agent/mcp/servers"}:
                self.send_json(404, {"error": "not_found"})
                return
            if not self.authorized():
                self.send_json(401, {"error": "invalid_token"})
                return
            if parsed_path.path == "/v1/providers/reasoning-translate/status":
                if not bridge.agent_runtime:
                    self.send_json(503, {"error": "agent_runtime_unavailable"});return
                query=urllib.parse.parse_qs(parsed_path.query)
                try:self.send_json(200,bridge.agent_runtime.reasoning_translations.status(str((query.get('id') or [''])[0]),str((query.get('roleId') or [''])[0])))
                except ValueError:self.send_json(404,{'error':'reasoning_translation_not_found'})
                return
            if parsed_path.path == "/v1/providers/chat-stream/status":
                if not bridge.chat_streams:
                    self.send_json(503, {"error": "agent_runtime_unavailable"}); return
                query = urllib.parse.parse_qs(parsed_path.query)
                try:
                    result = bridge.chat_streams.status(str((query.get("id") or [""])[0]), str((query.get("roleId") or [""])[0]))
                    self.send_json(200, result)
                except ValueError:
                    self.send_json(404, {"error": "stream_not_found"})
                return
            if parsed_path.path == "/v1/agent/mcp/servers":
                if not bridge.agent_runtime:
                    self.send_json(503, {"error": "agent_runtime_unavailable"}); return
                self.send_json(200, bridge.agent_runtime.remote_mcp.list()); return
            if parsed_path.path == "/v1/credentials/status":
                if not bridge.credential_vault:
                    self.send_json(503, {"error": "credential_vault_unavailable"})
                    return
                bridge.sync_extension_credentials()
                self.send_json(200, bridge.credential_vault.status())
                return
            if not bridge.agent_runtime:
                self.send_json(503, {"error": "agent_runtime_unavailable"})
                return
            if parsed_path.path in {"/v1/agent/capabilities", "/v1/agent/openapi.json"}:
                self.send_json(200, bridge.agent_protocols.openapi() if parsed_path.path.endswith("openapi.json") else bridge.agent_protocols.manifest())
                return
            if parsed_path.path == "/v1/agent/status":
                self.send_json(200, bridge.agent_runtime.status())
                return
            if parsed_path.path == "/v1/providers/acceptance":
                self.send_json(200, bridge.agent_runtime.provider_acceptance())
                return
            query = urllib.parse.parse_qs(parsed_path.query)
            if parsed_path.path == "/v1/agent/approvals":
                self.send_json(200, {
                    "ok": True,
                    "items": bridge.agent_runtime.approvals.list(
                        status=str((query.get("status") or [""])[0]),
                        session_id=str((query.get("sessionId") or [""])[0]),
                        limit=int((query.get("limit") or ["50"])[0]),
                    ),
                })
                return
            if parsed_path.path == "/v1/agent/runs/status":
                run_id = str((query.get("id") or [""])[0])
                self.send_json(200, {"ok": True, **bridge.agent_runtime.run_status(run_id)})
                return
            after = int((query.get("after") or ["0"])[0])
            self.send_json(200, {"ok": True, "events": bridge.agent_runtime.events_after(after)})

        def do_DELETE(self) -> None:
            path = urllib.parse.urlparse(self.path).path
            if path == "/v1/mcp":
                if self.headers.get("Origin") and not self.cors_origin():
                    self.send_json(403, {"error": "origin_not_allowed"}); return
                self.send_json(405 if self.authorized() else 401, {"error": "method_not_allowed" if self.authorized() else "invalid_token"})
            else:
                self.send_json(404, {"error": "not_found"})

        def handle_mcp_post(self) -> None:
            if not bridge.agent_protocols:
                self.reject_post(503, rpc_error(None, -32603, "Agent runtime unavailable")); return
            if self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower() != "application/json":
                self.reject_post(415, rpc_error(None, -32600, "application/json required")); return
            previous_timeout = self.connection.gettimeout()
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 65536:
                    self.reject_post(413, rpc_error(None, -32600, "Invalid body size")); return
                self.connection.settimeout(10)
                raw = self.rfile.read(length)
                if len(raw) != length:
                    self.send_json(400, rpc_error(None, -32700, "Incomplete body")); return
                payload = parse_json_message(raw.decode("utf-8"))
            except (ValueError, UnicodeDecodeError, OSError, RecursionError):
                self.send_json(400, rpc_error(None, -32700, "Parse error")); return
            finally:
                self.connection.settimeout(previous_timeout)
            status, response = bridge.agent_protocols.handle_mcp(payload, self.headers)
            self.send_json(status, response)

        def do_POST(self) -> None:
            parsed_path = urllib.parse.urlparse(self.path).path
            allowed_paths = {"/v1/actions", "/v1/agent/tools/execute", "/v1/agent/tasks/execute", "/v1/agent/runs/execute", "/v1/agent/runs/cancel", "/v1/agent/approvals/resolve", "/v1/agent/backups/create", "/v1/providers/request", "/v1/providers/acceptance/invalidate", "/v1/credentials", "/v1/credentials/delete", "/v1/credentials/orphans/purge", "/v1/providers/chat-stream/start", "/v1/providers/chat-stream/cancel", "/v1/mcp"}
            allowed_paths.update({"/v1/agent/mcp/servers/save", "/v1/agent/mcp/servers/discover", "/v1/agent/mcp/servers/delete", "/v1/agent/mcp/propose", "/v1/agent/mcp/cancel"})
            allowed_paths.update({'/v1/providers/reasoning-translate/start','/v1/providers/reasoning-translate/cancel'})
            if parsed_path not in allowed_paths:
                self.reject_post(404, {"error": "not_found"})
                return
            if not self.authorized():
                self.reject_post(401, {"error": "invalid_token"})
                return
            if self.headers.get("Origin") and not self.cors_origin():
                self.reject_post(403, {"error": "origin_not_allowed"}); return
            if parsed_path == "/v1/mcp":
                self.handle_mcp_post(); return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                body_limit = MAX_PROVIDER_BODY_BYTES if parsed_path in {"/v1/providers/request", "/v1/agent/tools/execute", "/v1/providers/chat-stream/start", "/v1/agent/runs/execute"} else MAX_BODY_BYTES
                if length <= 0 or length > body_limit:
                    raise ValueError("invalid_body_size")
                payload = json.loads(self.rfile.read(length).decode("utf-8"))
                if not isinstance(payload, dict):
                    raise ValueError("payload_must_be_object")
                if parsed_path.startswith("/v1/agent/mcp/"):
                    if not bridge.agent_runtime:
                        self.send_json(503, {"error": "agent_runtime_unavailable"}); return
                    service = bridge.agent_runtime.remote_mcp
                    if parsed_path.endswith("/save"):
                        result = service.save(payload)
                    elif parsed_path.endswith("/discover"):
                        result = service.discover(str(payload.get("serverId") or ""))
                    elif parsed_path.endswith("/delete"):
                        result = service.delete(str(payload.get("serverId") or ""))
                    elif parsed_path.endswith("/cancel"):
                        result = service.cancel(str(payload.get("operationId") or ""), str(payload.get("roleId") or ""))
                    else:
                        result = {"ok": True, "proposal": bridge.agent_runtime.propose_mcp_tool(payload)}
                    self.send_json(200 if result.get("ok") else 400, result); return
                if parsed_path in {"/v1/credentials", "/v1/credentials/delete", "/v1/credentials/orphans/purge"}:
                    if not bridge.credential_vault:
                        self.send_json(503, {"error": "credential_vault_unavailable"})
                        return
                    bridge.sync_extension_credentials()
                    if parsed_path.endswith("/orphans/purge"):
                        self.send_json(200, bridge.credential_vault.purge_orphans())
                        return
                    slot = str(payload.get("slot") or "")
                    result = bridge.credential_vault.delete(slot) if parsed_path.endswith("/delete") else bridge.credential_vault.set(slot, str(payload.get("secret") or ""))
                    self.send_json(200, result)
                    return
                if parsed_path == "/v1/providers/acceptance/invalidate":
                    if not bridge.agent_runtime:
                        self.send_json(503, {"error": "agent_runtime_unavailable"})
                        return
                    channels = payload.get("channels") if isinstance(payload.get("channels"), list) else []
                    self.send_json(200, bridge.agent_runtime.invalidate_provider_acceptance(channels))
                    return
                if parsed_path.startswith("/v1/providers/chat-stream/"):
                    if not bridge.chat_streams:
                        self.send_json(503, {"error": "agent_runtime_unavailable"}); return
                    if parsed_path.endswith("/start"):
                        provider = payload.get("provider") if isinstance(payload.get("provider"), dict) else {}
                        result = bridge.chat_streams.start({**payload, "provider": bridge.resolve_provider_credential(provider, "chat", str(payload.get('roleId') or ''))})
                    else:
                        result = bridge.chat_streams.cancel(str(payload.get("id") or ""), str(payload.get("roleId") or ""))
                    self.send_json(200, result)
                    return
                if parsed_path in {'/v1/providers/reasoning-translate/start','/v1/providers/reasoning-translate/cancel'}:
                    if not bridge.agent_runtime:
                        self.send_json(503,{'error':'agent_runtime_unavailable'});return
                    if parsed_path.endswith('/start'):
                        provider=payload.get('provider') if isinstance(payload.get('provider'),dict) else {}
                        resolved=bridge.resolve_provider_credential(provider,'chat',str(payload.get('roleId') or ''))
                        result=bridge.agent_runtime.reasoning_translations.start({**payload,'provider':resolved})
                    else:result=bridge.agent_runtime.reasoning_translations.cancel(payload.get('id'),payload.get('roleId'))
                    self.send_json(200,result);return
                if parsed_path == "/v1/providers/request":
                    if not bridge.agent_runtime:
                        self.send_json(503, {"error": "agent_runtime_unavailable"})
                        return
                    resolved_payload = dict(payload)
                    provider = payload.get("provider") if isinstance(payload.get("provider"), dict) else {}
                    expected_slot = {"chat": "chat", "image": "image", "voice": "voice"}.get(str(payload.get("route") or "").lower(), "")
                    if expected_slot:
                        resolved_payload["provider"] = bridge.resolve_provider_credential(provider, expected_slot, str(payload.get('roleId') or ''))
                    result = bridge.agent_runtime.proxy_provider_request(resolved_payload)
                    self.send_json(200, result)
                    return
                if parsed_path.startswith("/v1/agent/"):
                    if not bridge.agent_runtime:
                        self.send_json(503, {"error": "agent_runtime_unavailable"})
                        return
                    if parsed_path.endswith("/backups/create"):
                        result = bridge.agent_runtime.create_runtime_backup("manual")
                    elif parsed_path.endswith("/tools/execute"):
                        result = bridge.agent_runtime.registry.dispatch(
                            str(payload.get("name") or ""),
                            payload.get("args") if isinstance(payload.get("args"), dict) else {},
                        )
                    elif parsed_path.endswith("/runs/execute"):
                        result = bridge.agent_runtime.run_agent(bridge.resolve_agent_credentials(payload))
                    elif parsed_path.endswith("/runs/cancel"):
                        result = bridge.agent_runtime.cancel_run(str(payload.get("id") or ""))
                    elif parsed_path.endswith("/approvals/resolve"):
                        result = bridge.agent_runtime.resolve_action_proposal(
                            str(payload.get("id") or ""),
                            str(payload.get("decision") or ""),
                            bridge.execute_approved_proposal,
                        )
                    else:
                        result = bridge.agent_runtime.execute_task(payload)
                    self.send_json(200 if result.get("ok", result.get("status") != "failed") else 400, result)
                    return
                if payload.get("approved") is not True:
                    raise PermissionError("explicit_approval_required")
                result = bridge.execute(
                    str(payload.get("type") or ""),
                    payload.get("args") if isinstance(payload.get("args"), dict) else {},
                    str(payload.get("policy") or "ask_every_time"),
                )
                result["id"] = str(payload.get("id") or "")
                self.send_json(200, result)
            except PermissionError as error:
                self.send_json(403, {"error": str(error)})
            except (ValueError, FileNotFoundError) as error:
                self.send_json(400, {"error": str(error)})
            except subprocess.TimeoutExpired:
                self.send_json(504, {"error": "command_timeout"})
            except Exception as error:
                self.send_json(500, {"error": "internal_error", "detail": type(error).__name__})

    return Handler


def main() -> None:
    parser = argparse.ArgumentParser(description="Hermes localhost computer-control bridge")
    parser.add_argument("--port", type=int, default=8797)
    parser.add_argument("--token", default="")
    parser.add_argument("--allow-root", action="append", default=[])
    parser.add_argument("--allow-command", action="append", default=[])
    parser.add_argument("--knowledge-root", action="append", default=[])
    parser.add_argument("--data-dir", default="")
    parser.add_argument("--suppress-token-output", action="store_true")
    args = parser.parse_args()

    project_root = Path(__file__).resolve().parent
    roots = resolved_roots(args.allow_root or [str(project_root)])
    default_knowledge = project_root / "knowledge"
    default_knowledge.mkdir(parents=True, exist_ok=True)
    knowledge_roots = resolved_roots(args.knowledge_root or [str(default_knowledge)])
    data_dir = Path(args.data_dir).resolve() if args.data_dir else project_root / "data"
    runtime = AgentRuntime(data_dir, knowledge_roots)
    credential_vault = CredentialVault(data_dir / "provider-credentials.dpapi.json")
    runtime.start()
    token = args.token or os.environ.get("HERMES_BRIDGE_TOKEN", "") or secrets.token_urlsafe(24)
    bridge = Bridge(token, roots, set(args.allow_command), runtime, credential_vault)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(bridge))
    print(f"Hermes local bridge: http://127.0.0.1:{args.port}", flush=True)
    if not args.suppress_token_output:
        print(f"Session token: {token}", flush=True)
    print("Allowed roots:", ", ".join(str(root) for root in roots), flush=True)
    print("Knowledge roots:", ", ".join(str(root) for root in knowledge_roots), flush=True)
    print("Agent database:", runtime.db_path, flush=True)
    print("Commands:", ", ".join(sorted(bridge.allowed_commands)) or "disabled", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        if bridge.chat_streams:
            bridge.chat_streams.close()
        runtime.close()


if __name__ == "__main__":
    main()
