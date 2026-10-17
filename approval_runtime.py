"""Persistent action proposal and approval state machine for Project 5."""

from __future__ import annotations

import json
import sqlite3
import uuid
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable


MAX_PROPOSAL_BYTES = 65_536
TERMINAL_STATUSES = {"denied", "executed", "failed", "expired"}
ACTION_RISKS = {
    "mcp_tool_call": "R3",
    "office_create_document": "R2",
    "office_create_spreadsheet": "R2",
    "office_create_presentation": "R2",
    "screen_capture": "R1",
    "read_text_file": "R1",
    "open_url": "R2",
    "open_path": "R2",
    "write_text_file": "R3",
    "mouse_move": "R3",
    "mouse_click": "R3",
    "type_text": "R3",
    "key_press": "R3",
    "run_diagnostic": "R1",
}
ACTION_ARG_KEYS = {
    "mcp_tool_call": {"serverId", "serverUrl", "toolName", "arguments", "schemaHash", "roleId", "operationId"},
    "office_create_document": {"title", "blocks"},
    "office_create_spreadsheet": {"title", "columns", "rows"},
    "office_create_presentation": {"title", "slides"},
    "screen_capture": {"path"},
    "read_text_file": {"path"},
    "open_url": {"url"},
    "open_path": {"path"},
    "write_text_file": {"path", "text"},
    "mouse_move": {"x", "y"},
    "mouse_click": {"button"},
    "type_text": {"text"},
    "key_press": {"key"},
    "run_diagnostic": {"template", "path", "query", "limit"},
}
SENSITIVE_ARG_KEYS = {"apikey", "authorization", "bearer", "cookie", "credential", "password", "secret", "token"}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class ApprovalRuntime:
    def __init__(self, database_path: Path) -> None:
        self.database_path = database_path.resolve()
        self._init_database()
        self.recovered_executing = self._recover_executing()

    def connect(self) -> sqlite3.Connection:
        database = sqlite3.connect(self.database_path, timeout=10)
        database.row_factory = sqlite3.Row
        database.execute("PRAGMA journal_mode=WAL")
        return database

    def _init_database(self) -> None:
        with closing(self.connect()) as database, database:
            database.executescript("""
                CREATE TABLE IF NOT EXISTS action_proposals(
                    id TEXT PRIMARY KEY,session_id TEXT NOT NULL,role_id TEXT NOT NULL,
                    task_id TEXT NOT NULL,tool_call_id TEXT NOT NULL,action_type TEXT NOT NULL,
                    risk_level TEXT NOT NULL,summary TEXT NOT NULL,reason TEXT NOT NULL,
                    args_json TEXT NOT NULL,status TEXT NOT NULL,result_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,expires_at TEXT NOT NULL,decided_at TEXT NOT NULL,
                    completed_at TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS action_proposals_queue
                    ON action_proposals(status,created_at DESC);
                CREATE TABLE IF NOT EXISTS action_receipts(
                    id TEXT PRIMARY KEY,proposal_id TEXT NOT NULL UNIQUE,decision TEXT NOT NULL,
                    action_type TEXT NOT NULL,risk_level TEXT NOT NULL,input_json TEXT NOT NULL,
                    result_json TEXT NOT NULL,session_id TEXT NOT NULL,role_id TEXT NOT NULL,
                    task_id TEXT NOT NULL,tool_call_id TEXT NOT NULL,created_at TEXT NOT NULL);
            """)

    def _recover_executing(self) -> int:
        now = utc_now()
        recovered = 0
        with closing(self.connect()) as database, database:
            rows = database.execute("SELECT * FROM action_proposals WHERE status='executing'").fetchall()
            for row in rows:
                result = {"ok": False, "error": "approval_execution_interrupted"}
                database.execute(
                    "UPDATE action_proposals SET status='failed',result_json=?,completed_at=? WHERE id=? AND status='executing'",
                    (json.dumps(result, ensure_ascii=False), now, row["id"]),
                )
                self._insert_receipt(database, row, "failed", result, now)
                recovered += 1
        return recovered

    @staticmethod
    def _bounded_text(value: Any, field: str, maximum: int, *, required: bool = False) -> str:
        text = str(value or "").strip()
        if required and not text:
            raise ValueError(f"{field}_required")
        if len(text) > maximum:
            raise ValueError(f"{field}_too_long")
        return text

    @staticmethod
    def _decode_row(row: sqlite3.Row | None) -> dict[str, Any] | None:
        if row is None:
            return None
        item = dict(row)
        item["args"] = json.loads(item.pop("args_json") or "{}")
        item["result"] = json.loads(item.pop("result_json") or "{}")
        return item

    @staticmethod
    def _contains_sensitive_key(value: Any) -> bool:
        if isinstance(value, dict):
            for key, nested in value.items():
                normalized = "".join(character for character in str(key).lower() if character.isalnum())
                if normalized in SENSITIVE_ARG_KEYS or ApprovalRuntime._contains_sensitive_key(nested):
                    return True
        elif isinstance(value, list):
            return any(ApprovalRuntime._contains_sensitive_key(item) for item in value)
        return False

    def propose(self, payload: dict[str, Any]) -> dict[str, Any]:
        action_type = self._bounded_text(payload.get("actionType"), "action_type", 80, required=True)
        if action_type not in ACTION_RISKS:
            raise ValueError("action_type_not_allowed")
        args = payload.get("args")
        if not isinstance(args, dict):
            raise ValueError("action_args_must_be_object")
        if set(args) - ACTION_ARG_KEYS[action_type]:
            raise ValueError("action_args_unknown_key")
        if self._contains_sensitive_key(args):
            raise ValueError("action_args_sensitive_key")
        args_json = json.dumps(args, ensure_ascii=False, separators=(",", ":"))
        if len(args_json.encode("utf-8")) > MAX_PROPOSAL_BYTES:
            raise ValueError("action_args_too_large")
        now_dt = datetime.now(timezone.utc)
        ttl_minutes = max(1, min(1440, int(payload.get("ttlMinutes") or 30)))
        proposal_id = self._bounded_text(payload.get("id"), "proposal_id", 120) or f"approval-{uuid.uuid4().hex}"
        values = (
            proposal_id,
            self._bounded_text(payload.get("sessionId"), "session_id", 160) or "default",
            self._bounded_text(payload.get("roleId"), "role_id", 80) or "shared",
            self._bounded_text(payload.get("taskId"), "task_id", 160),
            self._bounded_text(payload.get("toolCallId"), "tool_call_id", 160),
            action_type,
            ACTION_RISKS[action_type],
            self._bounded_text(payload.get("summary"), "summary", 240, required=True),
            self._bounded_text(payload.get("reason"), "reason", 1000, required=True),
            args_json,
            "pending",
            "{}",
            now_dt.isoformat(),
            (now_dt + timedelta(minutes=ttl_minutes)).isoformat(),
            "",
            "",
        )
        with closing(self.connect()) as database, database:
            try:
                database.execute("INSERT INTO action_proposals VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", values)
            except sqlite3.IntegrityError as error:
                raise ValueError("proposal_id_exists") from error
            row = database.execute("SELECT * FROM action_proposals WHERE id=?", (proposal_id,)).fetchone()
        return self._decode_row(row) or {}

    def list(self, *, status: str = "", session_id: str = "", limit: int = 50) -> list[dict[str, Any]]:
        clauses, values = [], []
        if status:
            if status not in {"pending", "executing", *TERMINAL_STATUSES}:
                raise ValueError("proposal_status_invalid")
            clauses.append("status=?")
            values.append(status)
        if session_id:
            clauses.append("session_id=?")
            values.append(session_id)
        where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
        values.append(max(1, min(200, int(limit))))
        with closing(self.connect()) as database:
            rows = database.execute(
                f"SELECT * FROM action_proposals{where} ORDER BY created_at DESC LIMIT ?", values
            ).fetchall()
        return [self._decode_row(row) or {} for row in rows]

    def get(self, proposal_id: str) -> dict[str, Any] | None:
        with closing(self.connect()) as database:
            row = database.execute("SELECT * FROM action_proposals WHERE id=?", (proposal_id,)).fetchone()
        return self._decode_row(row)

    def receipt(self, proposal_id: str) -> dict[str, Any] | None:
        with closing(self.connect()) as database:
            row = database.execute("SELECT * FROM action_receipts WHERE proposal_id=?", (proposal_id,)).fetchone()
        if not row:
            return None
        item = dict(row)
        item["input"] = json.loads(item.pop("input_json") or "{}")
        item["result"] = json.loads(item.pop("result_json") or "{}")
        return item

    def resolve(
        self,
        proposal_id: str,
        decision: str,
        executor: Callable[[str, dict[str, Any]], dict[str, Any]],
    ) -> dict[str, Any]:
        if decision not in {"approve", "deny"}:
            raise ValueError("approval_decision_invalid")
        now = utc_now()
        with closing(self.connect()) as database:
            database.execute("BEGIN IMMEDIATE")
            row = database.execute("SELECT * FROM action_proposals WHERE id=?", (proposal_id,)).fetchone()
            if row is None:
                database.rollback()
                raise ValueError("proposal_not_found")
            if row["status"] in TERMINAL_STATUSES or row["status"] == "executing":
                database.commit()
                return {"proposal": self._decode_row(row), "receipt": self.receipt(proposal_id), "idempotent": True}
            if datetime.fromisoformat(row["expires_at"]) <= datetime.now(timezone.utc):
                result = {"ok": False, "error": "proposal_expired"}
                database.execute(
                    "UPDATE action_proposals SET status='expired',result_json=?,decided_at=?,completed_at=? WHERE id=? AND status='pending'",
                    (json.dumps(result), now, now, proposal_id),
                )
                self._insert_receipt(database, row, "expired", result, now)
                database.commit()
                return {"proposal": self.get(proposal_id), "receipt": self.receipt(proposal_id), "idempotent": False}
            if decision == "deny":
                result = {"ok": False, "error": "user_denied"}
                database.execute(
                    "UPDATE action_proposals SET status='denied',result_json=?,decided_at=?,completed_at=? WHERE id=? AND status='pending'",
                    (json.dumps(result), now, now, proposal_id),
                )
                self._insert_receipt(database, row, "denied", result, now)
                database.commit()
                return {"proposal": self.get(proposal_id), "receipt": self.receipt(proposal_id), "idempotent": False}
            changed = database.execute(
                "UPDATE action_proposals SET status='executing',decided_at=? WHERE id=? AND status='pending'",
                (now, proposal_id),
            ).rowcount
            database.commit()
        if changed != 1:
            current = self.get(proposal_id)
            return {"proposal": current, "receipt": self.receipt(proposal_id), "idempotent": True}
        try:
            execution_args=json.loads(row["args_json"] or "{}")
            if row['action_type'].startswith('office_create_'):execution_args={**execution_args,'roleId':row['role_id']}
            result = executor(row["action_type"], execution_args)
            if not isinstance(result, dict):
                result = {"ok": True, "result": result}
            status = "executed" if result.get("ok", True) else "failed"
        except Exception as error:
            result = {"ok": False, "error": type(error).__name__, "detail": str(error)}
            status = "failed"
        completed = utc_now()
        with closing(self.connect()) as database, database:
            database.execute(
                "UPDATE action_proposals SET status=?,result_json=?,completed_at=? WHERE id=? AND status='executing'",
                (status, json.dumps(result, ensure_ascii=False), completed, proposal_id),
            )
            self._insert_receipt(database, row, status, result, completed)
        return {"proposal": self.get(proposal_id), "receipt": self.receipt(proposal_id), "idempotent": False}

    @staticmethod
    def _insert_receipt(database: sqlite3.Connection, row: sqlite3.Row, decision: str, result: dict[str, Any], created_at: str) -> None:
        database.execute(
            "INSERT OR IGNORE INTO action_receipts VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                f"receipt-{uuid.uuid4().hex}", row["id"], decision, row["action_type"], row["risk_level"],
                row["args_json"], json.dumps(result, ensure_ascii=False), row["session_id"], row["role_id"],
                row["task_id"], row["tool_call_id"], created_at,
            ),
        )
