"""Verified online backups and startup recovery for the Hermes Agent Runtime."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import sqlite3
import threading
import time
import uuid
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


BACKUP_SCHEMA = "hermes_runtime_backup_v1"
BACKUP_REASONS = {"manual", "mutation", "shutdown", "startup"}


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


class RuntimeBackupManager:
    def __init__(
        self,
        database_path: Path,
        *,
        schema_version: int,
        max_backups: int = 7,
        min_interval_seconds: int = 300,
    ) -> None:
        self.database_path = database_path.resolve()
        self.backup_dir = self.database_path.parent / "runtime-backups"
        self.quarantine_root = self.database_path.parent / "runtime-quarantine"
        self.schema_version = int(schema_version)
        self.max_backups = max(1, min(30, int(max_backups)))
        self.min_interval_seconds = max(0, int(min_interval_seconds))
        self._lock = threading.Lock()
        self._dirty = False
        self._last_snapshot_monotonic: float | None = None
        self._last_error = ""
        self._snapshot_cache: list[dict[str, Any]] | None = None
        self.startup_recovery: dict[str, Any] = {"state": "pending"}

    @staticmethod
    def _quick_check(path: Path) -> bool:
        if not path.is_file() or path.stat().st_size == 0:
            return False
        uri = f"file:{path.as_posix()}?mode=ro"
        try:
            with closing(sqlite3.connect(uri, uri=True, timeout=5)) as database:
                rows = database.execute("PRAGMA quick_check").fetchall()
            return rows == [("ok",)]
        except (OSError, sqlite3.DatabaseError):
            return False

    def mark_dirty(self) -> None:
        self._dirty = True

    @property
    def dirty(self) -> bool:
        return self._dirty

    def _verified_candidates(self) -> list[dict[str, Any]]:
        if not self.backup_dir.exists():
            return []
        candidates: list[dict[str, Any]] = []
        for manifest_path in self.backup_dir.glob("*.json"):
            try:
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
                expected_database = manifest_path.with_suffix(".sqlite3").name
                if (
                    not isinstance(manifest, dict)
                    or manifest.get("schema") != BACKUP_SCHEMA
                    or manifest.get("database") != expected_database
                    or not isinstance(manifest.get("createdAt"), str)
                    or not isinstance(manifest.get("bytes"), int)
                    or not isinstance(manifest.get("sha256"), str)
                ):
                    continue
                database_path = self.backup_dir / expected_database
                if database_path.stat().st_size != manifest["bytes"]:
                    continue
                if _sha256(database_path) != manifest["sha256"]:
                    continue
                if not self._quick_check(database_path):
                    continue
                configuration = manifest.get('configuration')
                if configuration is not None:
                    expected_config = manifest_path.with_suffix('.mcp.json')
                    if not isinstance(configuration, dict) or configuration.get('file') != expected_config.name:
                        continue
                    if expected_config.stat().st_size != configuration.get('bytes') or _sha256(expected_config) != configuration.get('sha256'):
                        continue
                candidates.append({**manifest, "verified": True, "_path": database_path})
            except (OSError, ValueError, TypeError, json.JSONDecodeError):
                continue
        candidates.sort(key=lambda item: (item["createdAt"], item["database"]), reverse=True)
        self._snapshot_cache = candidates
        return candidates

    def verified_snapshots(self) -> list[dict[str, Any]]:
        return [
            {key: value for key, value in candidate.items() if key != "_path"}
            for candidate in self._verified_candidates()
        ]

    def _prune(self) -> None:
        candidates = self._verified_candidates()
        for candidate in candidates[self.max_backups:]:
            database_path = candidate["_path"]
            manifest_path = database_path.with_suffix(".json")
            database_path.unlink(missing_ok=True)
            manifest_path.unlink(missing_ok=True)
            database_path.with_suffix('.mcp.json').unlink(missing_ok=True)
        self._snapshot_cache = candidates[:self.max_backups]

    @staticmethod
    def _public_snapshot(candidate: dict[str, Any]) -> dict[str, Any]:
        return {key: value for key, value in candidate.items() if key != "_path"}

    def create_snapshot(self, reason: str, *, force: bool = False) -> dict[str, Any]:
        clean_reason = str(reason or "manual").strip().lower()
        if clean_reason not in BACKUP_REASONS:
            clean_reason = "manual"
        with self._lock:
            elapsed = None if self._last_snapshot_monotonic is None else time.monotonic() - self._last_snapshot_monotonic
            if not force and (not self._dirty or (elapsed is not None and elapsed < self.min_interval_seconds)):
                cached = self._snapshot_cache if self._snapshot_cache is not None else self._verified_candidates()
                if cached:
                    return {"ok": True, "created": False, **self._public_snapshot(cached[0])}
            if not self.database_path.is_file():
                raise RuntimeError("runtime_database_missing")

            self.backup_dir.mkdir(parents=True, exist_ok=True)
            stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
            stem = f"runtime-{stamp}-{uuid.uuid4().hex[:8]}"
            temporary_database = self.backup_dir / f".{stem}.sqlite3.tmp"
            final_database = self.backup_dir / f"{stem}.sqlite3"
            temporary_manifest = self.backup_dir / f".{stem}.json.tmp"
            final_manifest = self.backup_dir / f"{stem}.json"
            temporary_config = self.backup_dir / f'.{stem}.mcp.json.tmp'
            final_config = self.backup_dir / f'{stem}.mcp.json'
            try:
                with closing(sqlite3.connect(self.database_path, timeout=10)) as source:
                    with closing(sqlite3.connect(temporary_database, timeout=10)) as destination:
                        source.backup(destination)
                if not self._quick_check(temporary_database):
                    raise RuntimeError("runtime_backup_quick_check_failed")
                manifest = {
                    "schema": BACKUP_SCHEMA,
                    "database": final_database.name,
                    "createdAt": _utc_now(),
                    "reason": clean_reason,
                    "bytes": temporary_database.stat().st_size,
                    "sha256": _sha256(temporary_database),
                    "sourceSchemaVersion": self.schema_version,
                }
                config_source = self.database_path.parent / 'mcp-servers.json'
                if config_source.is_file():
                    raw = config_source.read_bytes()
                    if len(raw) > 1048576:
                        raise RuntimeError('runtime_mcp_config_backup_too_large')
                    data = json.loads(raw)
                    if not isinstance(data, dict) or data.get('version') != 1 or not isinstance(data.get('servers'), list):
                        raise RuntimeError('runtime_mcp_config_backup_invalid')
                    temporary_config.write_bytes(raw)
                    manifest['configuration'] = {'file': final_config.name, 'bytes': len(raw),
                        'sha256': _sha256(temporary_config), 'restorePolicy': 'explicit-reapproval'}
                temporary_manifest.write_text(json.dumps(manifest, ensure_ascii=True, indent=2), encoding="utf-8")
                os.replace(temporary_database, final_database)
                if temporary_config.exists():
                    os.replace(temporary_config, final_config)
                os.replace(temporary_manifest, final_manifest)
                self._dirty = False
                self._last_snapshot_monotonic = time.monotonic()
                self._last_error = ""
                self._prune()
                return {"ok": True, "created": True, "verified": True, **manifest}
            except Exception as error:
                temporary_database.unlink(missing_ok=True)
                temporary_manifest.unlink(missing_ok=True)
                temporary_config.unlink(missing_ok=True)
                self._last_error = f"{type(error).__name__}: {error}"
                raise

    def prepare_primary(self) -> dict[str, Any]:
        with self._lock:
            if not self.database_path.exists():
                self.startup_recovery = {"state": "new"}
                return dict(self.startup_recovery)
            if self._quick_check(self.database_path):
                self.startup_recovery = {"state": "healthy"}
                return dict(self.startup_recovery)

            candidates = self._verified_candidates()
            if not candidates:
                self.startup_recovery = {"state": "failed", "error": "runtime_database_corrupt_no_verified_backup"}
                raise RuntimeError("runtime_database_corrupt_no_verified_backup")

            selected = candidates[0]
            stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
            quarantine = self.quarantine_root / f"corrupt-{stamp}-{uuid.uuid4().hex[:8]}"
            quarantine.mkdir(parents=True, exist_ok=False)
            for source in (
                self.database_path,
                Path(f"{self.database_path}-wal"),
                Path(f"{self.database_path}-shm"),
            ):
                if source.exists():
                    source.replace(quarantine / source.name)

            temporary_primary = self.database_path.parent / f".{self.database_path.name}.restore-{uuid.uuid4().hex}.tmp"
            try:
                shutil.copy2(selected["_path"], temporary_primary)
                if not self._quick_check(temporary_primary):
                    raise RuntimeError("runtime_restored_database_quick_check_failed")
                os.replace(temporary_primary, self.database_path)
            finally:
                temporary_primary.unlink(missing_ok=True)

            self.startup_recovery = {
                "state": "recovered",
                "snapshot": selected["database"],
                "snapshotCreatedAt": selected["createdAt"],
                "quarantineDirectory": str(quarantine),
            }
            return dict(self.startup_recovery)

    def status(self) -> dict[str, Any]:
        candidates = self._snapshot_cache if self._snapshot_cache is not None else self._verified_candidates()
        snapshots = [self._public_snapshot(candidate) for candidate in candidates]
        latest = snapshots[0] if snapshots else None
        return {
            "ok": True,
            "directory": str(self.backup_dir),
            "acceptedCount": len(snapshots),
            "latest": latest,
            "dirty": self._dirty,
            "lastError": self._last_error,
            "startupRecovery": dict(self.startup_recovery),
            "retentionLimit": self.max_backups,
        }
