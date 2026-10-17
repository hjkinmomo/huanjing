"""Append task identities once; finish with an update that preserves linked records."""
import json
import sqlite3
from contextlib import closing


class TaskHistory:
    def __init__(self, connect):
        self.connect = connect

    def start(self, task_id, role_id, title, tool, safe_input, started):
        checkpoint = {"ok": False, "checkpoint": {"phase": "preparing", "startedAt": started}}
        try:
            with closing(self.connect()) as database, database:
                database.execute(
                    "INSERT INTO tasks(id,role_id,title,tool_name,status,input_json,output_json,created_at,finished_at) VALUES(?,?,?,?,?,?,?,?,?)",
                    (task_id, role_id, title, tool, "running", json.dumps(safe_input, ensure_ascii=False),
                     json.dumps(checkpoint, ensure_ascii=False), started, ""),
                )
        except sqlite3.IntegrityError:
            raise ValueError("task_id_exists") from None

    def finish(self, task_id, status, output, finished):
        with closing(self.connect()) as database, database:
            cursor = database.execute(
                "UPDATE tasks SET status=?,output_json=?,finished_at=? WHERE id=? AND status='running'",
                (status, json.dumps(output, ensure_ascii=False), finished, task_id),
            )
            if cursor.rowcount != 1:
                raise ValueError("task_state_conflict")
