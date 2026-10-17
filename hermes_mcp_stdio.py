"""MCP 2025-11-25 stdio compatibility proxy for the existing local bridge.

No second runtime or database is started. Token is read from HERMES_BRIDGE_TOKEN.
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from agent_protocols import CAPABILITIES, META_PREFIX, PROTOCOL_VERSION, SERVER_INFO, rpc_error, parse_json_message

LEGACY_VERSION = "2025-11-25"
MAX_LINE_BYTES = 65536


class StdioProxy:
    def __init__(self, bridge_url, token):
        parsed = urllib.parse.urlparse(bridge_url)
        if (parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}
                or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in {"", "/"}):
            raise ValueError("bridge_url_must_be_loopback_origin")
        if not token or any(ord(c) < 32 for c in token):
            raise ValueError("HERMES_BRIDGE_TOKEN_required")
        self.url, self.token = bridge_url.rstrip("/") + "/v1/mcp", token
        self.initialized = False

    def upstream(self, message):
        params = dict(message.get("params") or {})
        params["_meta"] = {META_PREFIX + "protocolVersion": PROTOCOL_VERSION,
                           META_PREFIX + "clientInfo": {"name": "hermes-stdio-proxy", "version": "1.1.0"},
                           META_PREFIX + "clientCapabilities": {}}
        forwarded = {**message, "params": params}
        headers = {"Authorization": "Bearer " + self.token, "Content-Type": "application/json",
                   "Accept": "application/json, text/event-stream", "MCP-Protocol-Version": PROTOCOL_VERSION,
                   "Mcp-Method": message["method"]}
        if message["method"] in {"tools/call", "resources/read"}:
            headers["Mcp-Name"] = str(params.get("name", params.get("uri", "")))
        request = urllib.request.Request(self.url, data=json.dumps(forwarded).encode("utf-8"), headers=headers)
        # Do not follow redirects with the local authorization token or use system proxies.
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *args, **kwargs):
                raise ValueError("bridge_redirect_blocked")
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        try:
            response = opener.open(request, timeout=40)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            data = response.read(1024 * 1024 + 1)
            if len(data) > 1024 * 1024:
                raise ValueError("bridge_response_too_large")
            result = json.loads(data)
        if "jsonrpc" not in result:
            return rpc_error(message["id"], -32603, "Local bridge rejected request")
        if isinstance(result.get("result"), dict):
            result["result"].pop("resultType", None)
        return result

    def handle(self, message):
        if not isinstance(message, dict) or message.get("jsonrpc") != "2.0" or not isinstance(message.get("method"), str):
            return rpc_error(None, -32600, "Invalid request")
        request_id = message.get("id")
        params = message.get("params", {})
        if not isinstance(params, dict):
            return rpc_error(request_id, -32602, "Params must be an object")
        if "id" not in message:
            if message["method"] == "notifications/initialized":
                self.initialized = getattr(self, "negotiated", False)
            return None
        if isinstance(request_id, bool) or not isinstance(request_id, (str, int)):
            return rpc_error(None, -32600, "Invalid request id")
        if message["method"] == "initialize":
            if not isinstance(params.get("capabilities"), dict) or not isinstance(params.get("clientInfo"), dict):
                return rpc_error(request_id, -32602, "Client metadata required")
            discovery = self.upstream({"jsonrpc": "2.0", "id": request_id, "method": "server/discover"})
            if "error" in discovery:
                return discovery
            self.negotiated = True
            return {"jsonrpc": "2.0", "id": request_id, "result": {
                "protocolVersion": LEGACY_VERSION, "capabilities": CAPABILITIES, "serverInfo": SERVER_INFO,
                "instructions": "Owner-authorized local tools. Desktop actions remain pending approval."}}
        if not self.initialized:
            return rpc_error(request_id, -32600, "Initialize and send notifications/initialized first")
        return self.upstream(message)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bridge-url", default="http://127.0.0.1:8797")
    options = parser.parse_args()
    try:
        proxy = StdioProxy(options.bridge_url, os.environ.get("HERMES_BRIDGE_TOKEN", ""))
    except ValueError as error:
        print(str(error), file=sys.stderr)
        return 2
    while True:
        line = sys.stdin.buffer.readline(MAX_LINE_BYTES + 1)
        if not line:
            return 0
        if len(line) > MAX_LINE_BYTES:
            print(json.dumps(rpc_error(None, -32600, "Request exceeds line limit")), flush=True)
            return 2
        try:
            request = parse_json_message(line)
        except (ValueError, UnicodeDecodeError, RecursionError):
            response = rpc_error(None, -32700, "Parse error")
        else:
            try:
                response = proxy.handle(request)
            except (OSError, ValueError):
                response = rpc_error(request.get("id") if isinstance(request, dict) else None, -32603, "Local bridge unavailable")
        if response is not None:
            print(json.dumps(response, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    raise SystemExit(main())
