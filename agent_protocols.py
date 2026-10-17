"""Authenticated MCP 2026-07-28 core adapter and discoverable HTTP contracts.

This module owns wire formats, never provider credentials or desktop execution.
"""
import base64
import binascii
import json
from agent_tool_catalog import MODEL_TOOL_NAMES, ROLE_SKILL_TOOLS, schema_for
from agent_tools import validate_arguments

PROTOCOL_VERSION = "2026-07-28"
META_PREFIX = "io.modelcontextprotocol/"
SERVER_INFO = {"name": "hermes-project5", "version": "1.1.0"}
MCP_TOOLS = tuple(name for name in MODEL_TOOL_NAMES if name not in {"web_search", "mcp_tool_list", "mcp_tool_propose"} | ROLE_SKILL_TOOLS)
CAPABILITIES = {"tools": {}, "resources": {}}


def parse_json_message(text):
    def reject_constant(value):
        raise ValueError("non_json_constant")
    parsed = json.loads(text, parse_constant=reject_constant)
    pending = [(parsed, 0)]
    while pending:
        value, depth = pending.pop()
        if depth > 64:
            raise ValueError("json_nesting_limit")
        children = value.values() if isinstance(value, dict) else value if isinstance(value, list) else ()
        pending.extend((child, depth + 1) for child in children)
    return parsed


def rpc_error(request_id, code, message, data=None):
    error = {"code": code, "message": message}
    if data is not None:
        error["data"] = data
    return {"jsonrpc": "2.0", "id": request_id, "error": error}


def decode_header(value):
    if value.startswith("=?base64?") and value.endswith("?="):
        try:
            return base64.b64decode(value[9:-2], validate=True).decode("utf-8")
        except (binascii.Error, UnicodeDecodeError):
            raise ValueError("invalid_header_encoding") from None
    if not value or value != value.strip() or any(ord(c) < 32 or ord(c) > 126 for c in value):
        raise ValueError("invalid_header_value")
    return value


class AgentProtocols:
    def __init__(self, runtime):
        self.runtime = runtime

    def tool_schema(self, name):
        schema = schema_for(name)
        if name in {"office_workspace_inventory", "conversation_search", "memory_search", "memory_conflict_list", "schedule_list", "action_propose", "action_proposal_list"}:
            schema["properties"]["roleId"] = {"type": "string", "minLength": 1, "maxLength": 128}
            schema.setdefault("required", []).append("roleId")
        if name == "knowledge_search":
            schema["properties"]["paths"] = {"type": "array", "maxItems": 16, "items": {"type": "string", "minLength": 1, "maxLength": 2048}}
            schema.setdefault("required", []).append("paths")
        return schema

    def tools(self):
        return [{"name": name, "description": self.runtime.registry.tools[name]["description"],
                 "inputSchema": self.tool_schema(name),
                 "annotations": {"readOnlyHint": name != "action_propose", "destructiveHint": False,
                                 "openWorldHint": name == "web_fetch"}}
                for name in sorted(MCP_TOOLS)]

    def manifest(self):
        return {"service": SERVER_INFO, "protocols": [
            {"name": "Hermes HTTP JSON", "endpoint": "/v1/agent/tools/execute"},
            {"name": "MCP", "version": PROTOCOL_VERSION, "transport": "Streamable HTTP", "endpoint": "/v1/mcp"},
            {"name": "MCP", "version": "2025-11-25", "transport": "stdio", "entrypoint": "hermes_mcp_stdio.py"},
        ], "contracts": {"openapi": "/v1/agent/openapi.json"},
            "modelTools": list(MODEL_TOOL_NAMES), "mcpTools": list(sorted(MCP_TOOLS)),
            "limits": {"parallelRuns": 4, "iterations": 6, "toolCallsPerIteration": 3, "toolResultCharacters": 16000},
            "policy": {"externalDesktopExecution": False, "actionProposalsRequireApproval": True,
                       "outboundMcp": {"transport": "HTTP JSON/SSE tools subset", "authentication": False,
                           "callsRequireApproval": True, "roleBindingRequired": True, "modelServerScopeRequired": True},
                       "workItemScopeRequiredForModel": True, "roleScopeIncludesSharedMemories": False}}

    def resources(self):
        return [{"uri": "hermes://agent/capabilities", "name": "Agent capabilities", "mimeType": "application/json"},
                {"uri": "hermes://agent/runtime", "name": "Runtime summary", "mimeType": "application/json"}]

    def handle_mcp(self, request, headers):
        request_id = request.get("id") if isinstance(request, dict) else None
        if not isinstance(request, dict) or request.get("jsonrpc") != "2.0" or not isinstance(request.get("method"), str):
            return 400, rpc_error(None, -32600, "Invalid request")
        if "id" not in request or isinstance(request_id, bool) or not isinstance(request_id, (str, int)):
            return 400, rpc_error(None, -32600, "Requests require a string or integer id; notifications are unsupported")
        params = request.get("params", {})
        if not isinstance(params, dict):
            return 400, rpc_error(request_id, -32602, "Params must be an object")
        meta = params.get("_meta", {})
        if not isinstance(meta, dict):
            return 400, rpc_error(request_id, -32602, "Invalid metadata")
        version = headers.get("MCP-Protocol-Version", "")
        if not version or version != meta.get(META_PREFIX + "protocolVersion") or headers.get("Mcp-Method") != request["method"]:
            return 400, rpc_error(request_id, -32020, "Required headers must match request metadata")
        if version != PROTOCOL_VERSION:
            return 400, rpc_error(request_id, -32022, "Unsupported protocol version", {"supported": [PROTOCOL_VERSION], "requested": version})
        if not isinstance(meta.get(META_PREFIX + "clientCapabilities"), dict):
            return 400, rpc_error(request_id, -32602, "clientCapabilities metadata required")
        accept = {item.split(";", 1)[0].strip() for item in headers.get("Accept", "").split(",")}
        if not {"application/json", "text/event-stream"} <= accept:
            return 406, rpc_error(request_id, -32600, "Accept must include application/json and text/event-stream")
        if request["method"] in {"tools/call", "resources/read"}:
            try:
                if decode_header(headers.get("Mcp-Name", "")) != params.get("name", params.get("uri")):
                    raise ValueError("header_mismatch")
            except ValueError:
                return 400, rpc_error(request_id, -32020, "Mcp-Name must match the body")
        try:
            result = self._dispatch(request["method"], params)
        except ValueError as error:
            return 400, rpc_error(request_id, -32602, str(error))
        except KeyError:
            return 404, rpc_error(request_id, -32601, "Method not found", {"supportedVersions": [PROTOCOL_VERSION]})
        except Exception:
            return 500, rpc_error(request_id, -32603, "Internal error")
        result = {"resultType": "complete", **result, "_meta": {META_PREFIX + "serverInfo": SERVER_INFO}}
        return 200, {"jsonrpc": "2.0", "id": request_id, "result": result}

    def _dispatch(self, method, params):
        if method == "server/discover":
            return {"supportedVersions": [PROTOCOL_VERSION], "capabilities": CAPABILITIES,
                    "instructions": "Local owner-authorized tools. Explicit role and file scope. Proposals await user approval."}
        if method == "ping":
            return {}
        if method in {"tools/list", "resources/list", "resources/templates/list"} and params.get("cursor"):
            raise ValueError("invalid_cursor")
        if method == "tools/list":
            return {"tools": self.tools()}
        if method == "tools/call":
            name = params.get("name")
            if name not in MCP_TOOLS:
                raise ValueError("tool_not_exposed")
            args = params.get("arguments", {})
            error = validate_arguments(args, self.tool_schema(name))
            if error:
                raise ValueError(error)
            if name == "knowledge_search" and not args["paths"]:
                raise ValueError("explicit_knowledge_paths_required")
            result = self.runtime.registry.dispatch(name, args)
            encoded = json.dumps(result, ensure_ascii=False)
            if len(encoded.encode("utf-8")) > 512000:
                result = {"ok": False, "error": "result_too_large", "detail": "Request fewer items."}
                encoded = json.dumps(result)
            return {"content": [{"type": "text", "text": encoded}], "structuredContent": result, "isError": not result.get("ok", False)}
        if method == "resources/list":
            return {"resources": self.resources()}
        if method == "resources/templates/list":
            return {"resourceTemplates": []}
        if method == "resources/read":
            uri = params.get("uri")
            if uri == "hermes://agent/capabilities":
                content = self.manifest()
            elif uri == "hermes://agent/runtime":
                status = self.runtime.status()
                content = {key: status[key] for key in ("schemaVersion", "scheduler")}
                content["toolCount"] = len(status["tools"])
            else:
                raise ValueError("resource_not_found")
            return {"contents": [{"uri": uri, "mimeType": "application/json", "text": json.dumps(content, ensure_ascii=False)}]}
        raise KeyError(method)

    def openapi(self):
        # Document a bounded, implemented subset, rather than guessed routes.
        tools = [{"type": "object", "properties": {"name": {"const": name}, "args": self.tool_schema(name)},
                  "required": ["name", "args"], "additionalProperties": False} for name in sorted(MCP_TOOLS)]
        response = {"description": "JSON response", "content": {"application/json": {"schema": {"type": "object"}}}}
        auth = {"security": [{"localBearer": []}], "responses": {"200": response, "400": response, "401": response}}
        return {"openapi": "3.1.1", "info": {"title": "Hermes Agent Interoperability", "version": "1.1.0"},
                "servers": [{"url": "/"}], "components": {"securitySchemes": {"localBearer": {"type": "http", "scheme": "bearer"}}},
                "paths": {
                    "/v1/agent/capabilities": {"get": {**auth, "operationId": "getAgentCapabilities"}},
                    "/v1/agent/tools/execute": {"post": {**auth, "operationId": "executeAgentTool",
                        "requestBody": {"required": True, "content": {"application/json": {"schema": {"oneOf": tools}}}}}},
                    "/v1/mcp": {"post": {**auth, "operationId": "callMcp",
                        "description": "MCP 2026-07-28 Streamable HTTP; required metadata and mirrored headers.",
                        "requestBody": {"required": True, "content": {"application/json": {"schema": {"type": "object"}}}},
                        "parameters": [{"name": name, "in": "header", "required": required, "schema": {"type": "string"}}
                                       for name, required in [("MCP-Protocol-Version", True), ("Mcp-Method", True), ("Mcp-Name", False), ("Accept", True)]]}},
                }}
