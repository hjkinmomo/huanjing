"""Windows DPAPI-backed provider credential slots for Hermes Project 5."""

from __future__ import annotations

import base64
import ctypes
import json
import os
import sys
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable


CREDENTIAL_SLOTS = {"chat", "image", "search", "voice"}
CORE_SLOT_LABELS = {
    "chat": "Chat Provider",
    "image": "Image Provider",
    "search": "Search Provider",
    "voice": "Voice Provider",
}
CRYPTPROTECT_UI_FORBIDDEN = 0x1


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class DATA_BLOB(ctypes.Structure):
    _fields_ = [("cbData", ctypes.c_ulong), ("pbData", ctypes.POINTER(ctypes.c_ubyte))]


def _blob(data: bytes) -> tuple[DATA_BLOB, ctypes.Array]:
    buffer = ctypes.create_string_buffer(data)
    return DATA_BLOB(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte))), buffer


def dpapi_protect(data: bytes) -> bytes:
    if sys.platform != "win32":
        raise RuntimeError("credential_vault_windows_only")
    source, source_buffer = _blob(data)
    output = DATA_BLOB()
    if not ctypes.windll.crypt32.CryptProtectData(  # type: ignore[attr-defined]
        ctypes.byref(source), "Hermes Project 5 Provider Credential", None, None, None,
        CRYPTPROTECT_UI_FORBIDDEN, ctypes.byref(output),
    ):
        raise ctypes.WinError()
    try:
        return ctypes.string_at(output.pbData, output.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(output.pbData)  # type: ignore[attr-defined]
        del source_buffer


def dpapi_unprotect(data: bytes) -> bytes:
    if sys.platform != "win32":
        raise RuntimeError("credential_vault_windows_only")
    source, source_buffer = _blob(data)
    output = DATA_BLOB()
    if not ctypes.windll.crypt32.CryptUnprotectData(  # type: ignore[attr-defined]
        ctypes.byref(source), None, None, None, None,
        CRYPTPROTECT_UI_FORBIDDEN, ctypes.byref(output),
    ):
        raise ctypes.WinError()
    try:
        return ctypes.string_at(output.pbData, output.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(output.pbData)  # type: ignore[attr-defined]
        del source_buffer


class CredentialVault:
    def __init__(
        self,
        path: Path,
        protect: Callable[[bytes], bytes] = dpapi_protect,
        unprotect: Callable[[bytes], bytes] = dpapi_unprotect,
    ) -> None:
        self.path = Path(path)
        self.protect = protect
        self.unprotect = unprotect
        self.lock = threading.RLock()
        self.extension_slots: dict[str, dict] = {}

    @property
    def available(self) -> bool:
        return sys.platform == "win32" or self.protect is not dpapi_protect

    def replace_extension_slots(self, definitions: dict[str, dict]) -> None:
        normalized: dict[str, dict] = {}
        for raw_slot, raw_metadata in definitions.items():
            slot = str(raw_slot or "").strip().lower()
            metadata = dict(raw_metadata or {})
            package_id = str(metadata.get("packageId") or "").strip().lower()
            if not slot.startswith("ext.") or not package_id or not slot.startswith(f"ext.{package_id}."):
                raise ValueError("credential_slot_definition_invalid")
            normalized[slot] = {
                "kind": "extension",
                "label": str(metadata.get("label") or slot)[:80],
                "description": str(metadata.get("description") or "")[:240],
                "packageId": package_id,
                "packageName": str(metadata.get("packageName") or package_id)[:80],
                "active": metadata.get("active") is True,
                "enabled": metadata.get("enabled") is True,
                "requiresReview": metadata.get("requiresReview") is True,
            }
        with self.lock:
            self.extension_slots = normalized

    def _slot(self, value: str, *, require_active: bool = True) -> str:
        slot = str(value or "").strip().lower()
        if slot in CREDENTIAL_SLOTS:
            return slot
        metadata = self.extension_slots.get(slot)
        if metadata is None:
            raise ValueError("credential_slot_invalid")
        if require_active and metadata.get("active") is not True:
            raise PermissionError("credential_slot_inactive")
        return slot

    def migrate_role_slots(self, slots: list[str]) -> None:
        """Copy the old encrypted slot once; later edits never affect another role."""
        with self.lock:
            payload = self._load()
            migrated = set(payload.get('roleSlotsMigrated', []))
            changed = False
            for slot in slots:
                self._slot(slot)
                if slot in migrated or not payload['entries'].get('chat'):continue
                if slot not in payload['entries']:
                    payload['entries'][slot] = dict(payload['entries']['chat'])
                migrated.add(slot);changed=True
            if changed:
                payload['roleSlotsMigrated'] = sorted(migrated)
                self._write(payload)

    def _load(self) -> dict:
        if not self.path.exists():
            return {"schema": 1, "entries": {}}
        try:
            payload = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise ValueError("credential_vault_corrupt") from error
        if payload.get("schema") != 1 or not isinstance(payload.get("entries"), dict):
            raise ValueError("credential_vault_corrupt")
        return payload

    def _write(self, payload: dict) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(f"{self.path.suffix}.tmp")
        temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        os.replace(temporary, self.path)

    def set(self, slot: str, secret: str) -> dict:
        clean_slot = self._slot(slot)
        clean_secret = str(secret or "").strip()
        if not clean_secret or len(clean_secret.encode("utf-8")) > 16_384:
            raise ValueError("credential_secret_invalid")
        encrypted = self.protect(clean_secret.encode("utf-8"))
        now = utc_now()
        with self.lock:
            payload = self._load()
            payload["entries"][clean_slot] = {
                "ciphertext": base64.b64encode(encrypted).decode("ascii"),
                "updatedAt": now,
            }
            self._write(payload)
        return {"ok": True, "slot": clean_slot, "configured": True, "updatedAt": now}

    def resolve(self, slot: str) -> str:
        clean_slot = self._slot(slot)
        with self.lock:
            entry = self._load()["entries"].get(clean_slot)
        if not isinstance(entry, dict) or not entry.get("ciphertext"):
            raise ValueError("credential_not_configured")
        try:
            encrypted = base64.b64decode(str(entry["ciphertext"]), validate=True)
            return self.unprotect(encrypted).decode("utf-8")
        except (ValueError, UnicodeDecodeError, OSError) as error:
            raise ValueError("credential_decrypt_failed") from error

    def delete(self, slot: str) -> dict:
        clean_slot = self._slot(slot, require_active=False)
        with self.lock:
            payload = self._load()
            existed = clean_slot in payload["entries"]
            payload["entries"].pop(clean_slot, None)
            self._write(payload)
        return {"ok": True, "slot": clean_slot, "configured": False, "deleted": existed}

    def status(self) -> dict:
        with self.lock:
            entries = self._load()["entries"]
            extension_slots = {slot: dict(metadata) for slot, metadata in self.extension_slots.items()}
        known_slots = CREDENTIAL_SLOTS.union(extension_slots)
        slots = {
            slot: {
                "kind": "core",
                "label": CORE_SLOT_LABELS[slot],
                "active": True,
                "configured": slot in entries,
                "updatedAt": str(entries.get(slot, {}).get("updatedAt") or ""),
            }
            for slot in sorted(CREDENTIAL_SLOTS)
        }
        for slot, metadata in sorted(extension_slots.items()):
            slots[slot] = {
                **metadata,
                "configured": slot in entries,
                "updatedAt": str(entries.get(slot, {}).get("updatedAt") or ""),
            }
        return {
            "ok": True,
            "available": self.available,
            "backend": "windows_dpapi" if self.protect is dpapi_protect else "test_protector",
            "slots": slots,
            "orphanedCount": sum(1 for slot in entries if slot not in known_slots),
        }

    def purge_orphans(self) -> dict:
        with self.lock:
            payload = self._load()
            known_slots = CREDENTIAL_SLOTS.union(self.extension_slots)
            orphaned = [slot for slot in payload["entries"] if slot not in known_slots]
            for slot in orphaned:
                payload["entries"].pop(slot, None)
            if orphaned:
                self._write(payload)
        return {"ok": True, "purgedCount": len(orphaned), "orphanedCount": 0}
