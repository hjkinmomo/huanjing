"""Declarative extension package discovery for Hermes Project 5."""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any


MAX_MANIFEST_BYTES = 64 * 1024
PACKAGE_ID = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$")
VERSION = re.compile(r"^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$")
CAPABILITY = re.compile(r"^[a-z][a-z0-9_.-]{1,79}$")
PACKAGE_TYPES = {"plugin", "theme", "skill"}
RISK_LEVELS = {"R0", "R1", "R2", "R3"}
EXECUTABLE_KEYS = {"entry", "entrypoint", "script", "module", "command", "hooks", "python", "javascript"}
THEME_TOKEN_ALLOWLIST = {
    "--ink", "--muted", "--paper", "--panel", "--line",
    "--wine", "--plum", "--amber", "--green",
}
COLOR_VALUE = re.compile(r"^#[0-9a-fA-F]{6}$")
SKILL_TOOL_ALLOWLIST = {
    "knowledge_search", "memory_search", "schedule_list", "office_workspace_inventory",
    "web_search", "web_fetch", "action_propose", "action_proposal_list",
}
MAX_SKILLS_PER_PACKAGE = 12
MAX_SKILL_INSTRUCTION_BYTES = 8 * 1024
ROLE_ID = re.compile(r'^[A-Za-z0-9_.:-]{1,100}$')
MAX_CREDENTIAL_SLOTS_PER_PACKAGE = 8
CREDENTIAL_SLOT_FIELDS = {"id", "label", "description"}


class ExtensionManifestError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class ExtensionPackage:
    id: str
    name: str
    version: str
    description: str
    type: str
    risk_level: str
    capabilities: tuple[str, ...]
    default_enabled: bool
    theme_tokens: dict[str, str]
    office_templates: tuple[dict[str, Any], ...]
    skills: tuple[dict[str, Any], ...]
    credential_slots: tuple[dict[str, str], ...]
    source: str
    manifest_path: str
    content_hash: str

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["riskLevel"] = payload.pop("risk_level")
        payload["defaultEnabled"] = payload.pop("default_enabled")
        payload["themeTokens"] = payload.pop("theme_tokens")
        payload["officeTemplates"] = payload.pop("office_templates")
        payload["skills"] = [dict(item) for item in self.skills]
        payload["credentialSlots"] = [dict(item) for item in payload.pop("credential_slots")]
        payload["manifestPath"] = payload.pop("manifest_path")
        payload["contentHash"] = payload.pop("content_hash")
        payload["capabilities"] = list(self.capabilities)
        payload["officeTemplates"] = [dict(item) for item in self.office_templates]
        return payload


@dataclass(frozen=True, slots=True)
class ExtensionCatalog:
    packages: tuple[ExtensionPackage, ...]
    errors: tuple[dict[str, str], ...]

    def to_dict(self) -> dict[str, Any]:
        return {
            "packages": [package.to_dict() for package in self.packages],
            "errors": [dict(item) for item in self.errors],
            "packageCount": len(self.packages),
            "errorCount": len(self.errors),
        }


class ExtensionRegistry:
    def __init__(self, root: Path | str, user_root: Path | str | None = None) -> None:
        self.root = Path(root).resolve()
        self.user_root = Path(user_root).resolve() if user_root is not None else None

    def scan(self) -> ExtensionCatalog:
        packages: list[ExtensionPackage] = []
        errors: list[dict[str, str]] = []
        seen: set[str] = set()
        sources = [("bundled", self.root)]
        if self.user_root is not None and self.user_root != self.root:
            sources.append(("user", self.user_root))
        for source, source_root in sources:
            if not source_root.exists():
                continue
            for directory in sorted((item for item in source_root.iterdir() if item.is_dir()), key=lambda item: item.name.casefold()):
                manifest = directory / "manifest.json"
                if not manifest.is_file():
                    continue
                try:
                    package = self._load_manifest(manifest, source=source, source_root=source_root)
                    if package.id in seen:
                        raise ExtensionManifestError(f"duplicate_extension_id:{package.id}")
                    seen.add(package.id)
                    packages.append(package)
                except (ExtensionManifestError, OSError, json.JSONDecodeError) as error:
                    errors.append({"path": str(manifest), "error": str(error) or type(error).__name__})
        return ExtensionCatalog(tuple(packages), tuple(errors))

    def _load_manifest(self, path: Path, *, source: str = "bundled", source_root: Path | None = None) -> ExtensionPackage:
        resolved = path.resolve()
        expected_root = (source_root or self.root).resolve()
        if expected_root != resolved.parent.parent:
            raise ExtensionManifestError("manifest_outside_extension_root")
        raw = resolved.read_bytes()
        if len(raw) > MAX_MANIFEST_BYTES:
            raise ExtensionManifestError("manifest_too_large")
        data = json.loads(raw.decode("utf-8"))
        if not isinstance(data, dict):
            raise ExtensionManifestError("manifest_must_be_object")
        forbidden = sorted(EXECUTABLE_KEYS.intersection(data))
        if forbidden:
            raise ExtensionManifestError(f"executable_manifest_key_forbidden:{forbidden[0]}")
        if data.get("schemaVersion") != 1:
            raise ExtensionManifestError("unsupported_manifest_schema")

        package_id = str(data.get("id") or "").strip()
        if not PACKAGE_ID.fullmatch(package_id):
            raise ExtensionManifestError("invalid_extension_id")
        name = str(data.get("name") or "").strip()
        description = str(data.get("description") or "").strip()
        version = str(data.get("version") or "").strip()
        package_type = str(data.get("type") or "").strip()
        risk_level = str(data.get("riskLevel") or "").strip().upper()
        if not name or len(name) > 80 or not description or len(description) > 500:
            raise ExtensionManifestError("invalid_extension_text")
        if not VERSION.fullmatch(version):
            raise ExtensionManifestError("invalid_extension_version")
        if package_type not in PACKAGE_TYPES:
            raise ExtensionManifestError("invalid_extension_type")
        if risk_level not in RISK_LEVELS:
            raise ExtensionManifestError("invalid_extension_risk")

        raw_capabilities = data.get("capabilities") or []
        if not isinstance(raw_capabilities, list) or len(raw_capabilities) > 32:
            raise ExtensionManifestError("invalid_extension_capabilities")
        capabilities = tuple(str(value).strip() for value in raw_capabilities)
        if len(capabilities) != len(set(capabilities)) or any(not CAPABILITY.fullmatch(value) for value in capabilities):
            raise ExtensionManifestError("invalid_extension_capabilities")

        raw_tokens = data.get("themeTokens") or {}
        if not isinstance(raw_tokens, dict):
            raise ExtensionManifestError("invalid_theme_tokens")
        theme_tokens = {str(key): str(value) for key, value in raw_tokens.items()}
        if package_type != "theme" and theme_tokens:
            raise ExtensionManifestError("theme_tokens_on_non_theme")
        if any(key not in THEME_TOKEN_ALLOWLIST or not COLOR_VALUE.fullmatch(value) for key, value in theme_tokens.items()):
            raise ExtensionManifestError("invalid_theme_tokens")

        raw_templates = data.get("officeTemplates") or []
        if not isinstance(raw_templates, list) or len(raw_templates) > 12 or any(not isinstance(item, dict) for item in raw_templates):
            raise ExtensionManifestError("invalid_office_templates")
        office_templates = tuple({
            "id": str(item.get("id") or "")[:64],
            "label": str(item.get("label") or "")[:100],
            "format": str(item.get("format") or "")[:12],
        } for item in raw_templates)
        if any(not PACKAGE_ID.fullmatch(item["id"]) or item["format"] not in {"docx", "xlsx", "pptx"} or not item["label"] for item in office_templates):
            raise ExtensionManifestError("invalid_office_templates")

        raw_skills = data.get("skills") or []
        if not isinstance(raw_skills, list) or len(raw_skills) > MAX_SKILLS_PER_PACKAGE or any(not isinstance(item, dict) for item in raw_skills):
            raise ExtensionManifestError("invalid_skills")
        if package_type != "skill" and raw_skills:
            raise ExtensionManifestError("skills_on_non_skill")
        skills: list[dict[str, Any]] = []
        seen_skills: set[str] = set()
        file_material = []
        def read_skill_file(relative):
            if not isinstance(relative, str) or len(relative) > 180 or '\\' in relative:
                raise ExtensionManifestError('invalid_skill_file')
            candidate = Path(relative)
            if candidate.is_absolute() or '..' in candidate.parts or candidate.suffix != '.md':
                raise ExtensionManifestError('invalid_skill_file')
            target = (resolved.parent / candidate).resolve()
            if not target.is_relative_to(resolved.parent) or not target.is_file():
                raise ExtensionManifestError('skill_file_outside_package_or_missing')
            if target.stat().st_size > MAX_SKILL_INSTRUCTION_BYTES:
                raise ExtensionManifestError('skill_file_too_large')
            content = target.read_bytes()
            file_material.append(relative.encode() + b'\0' + content)
            try:
                return content.decode('utf-8').replace('\r\n', '\n')
            except UnicodeDecodeError as error:
                raise ExtensionManifestError('skill_file_encoding_invalid') from error
        for item in raw_skills:
            skill_id = str(item.get("id") or "").strip()
            skill_name = str(item.get("name") or "").strip()
            skill_description = str(item.get("description") or "").strip()
            instructions = str(item.get("instructions") or "").strip()
            instruction_file = item.get('instructionFile')
            if instruction_file is not None:
                if instructions:
                    raise ExtensionManifestError('skill_has_two_instruction_sources')
                instructions = read_skill_file(instruction_file).strip()
                # Manifest metadata is authoritative. Standard SKILL.md frontmatter is
                # accepted as an authoring format, not interpreted as executable policy.
                if instructions.startswith('---\n'):
                    parts = instructions.split('\n---', 1)
                    if len(parts) != 2:
                        raise ExtensionManifestError('skill_frontmatter_invalid')
                    declared = re.search(r'(?m)^name:\s*([a-z0-9-]+)\s*$', parts[0])
                    if not declared or declared.group(1) != skill_id:
                        raise ExtensionManifestError('skill_frontmatter_name_mismatch')
                    instructions = parts[1].strip()
            suggested_tools = item.get("suggestedTools") or []
            if not PACKAGE_ID.fullmatch(skill_id) or skill_id in seen_skills:
                raise ExtensionManifestError("invalid_skill_id")
            if not skill_name or len(skill_name) > 100 or len(skill_description) > 500:
                raise ExtensionManifestError("invalid_skill_text")
            if not instructions or len(instructions.encode("utf-8")) > MAX_SKILL_INSTRUCTION_BYTES:
                raise ExtensionManifestError("invalid_skill_instructions")
            if not isinstance(suggested_tools, list) or len(suggested_tools) > 12:
                raise ExtensionManifestError("invalid_skill_tools")
            normalized_tools = tuple(str(tool).strip() for tool in suggested_tools)
            if len(normalized_tools) != len(set(normalized_tools)) or any(tool not in SKILL_TOOL_ALLOWLIST for tool in normalized_tools):
                raise ExtensionManifestError("invalid_skill_tools")
            contexts = item.get("contexts", ["agent"])
            if not isinstance(contexts, list) or not contexts or len(contexts) > 4 or any(value not in {"agent", "chat", "moments", "story"} for value in contexts):
                raise ExtensionManifestError("invalid_skill_contexts")
            modes = item.get('personaModes', ['normal'])
            roles = item.get('roleIds', [])
            if not isinstance(modes, list) or not modes or len(modes) > 1 or any(v not in {'normal'} for v in modes):
                raise ExtensionManifestError('invalid_skill_modes')
            if not isinstance(roles, list) or len(roles) > 100 or any(not isinstance(v, str) or not ROLE_ID.fullmatch(v) for v in roles):
                raise ExtensionManifestError('invalid_skill_roles')
            references = item.get('references', [])
            if not isinstance(references, list) or len(references) > 8 or any(not isinstance(v, str) for v in references) or len(set(references)) != len(references):
                raise ExtensionManifestError('invalid_skill_references')
            reference_texts = {reference: read_skill_file(reference) for reference in references}
            seen_skills.add(skill_id)
            skills.append({
                "id": skill_id, "name": skill_name, "description": skill_description,
                "instructions": instructions, "suggestedTools": list(normalized_tools), "contexts": list(dict.fromkeys(contexts)),
                'personaModes': list(dict.fromkeys(modes)), 'roleIds': roles,
                'instructionFile': instruction_file, 'references': reference_texts,
            })

        raw_credential_slots = data.get("credentialSlots") or []
        if (
            not isinstance(raw_credential_slots, list)
            or len(raw_credential_slots) > MAX_CREDENTIAL_SLOTS_PER_PACKAGE
            or any(not isinstance(item, dict) for item in raw_credential_slots)
        ):
            raise ExtensionManifestError("invalid_credential_slots")
        if package_type != "plugin" and raw_credential_slots:
            raise ExtensionManifestError("credential_slots_on_non_plugin")
        credential_slots: list[dict[str, str]] = []
        seen_credential_slots: set[str] = set()
        for item in raw_credential_slots:
            if set(item) - CREDENTIAL_SLOT_FIELDS:
                raise ExtensionManifestError("invalid_credential_slot_fields")
            slot_id = str(item.get("id") or "").strip()
            label = str(item.get("label") or "").strip()
            description = str(item.get("description") or "").strip()
            if not PACKAGE_ID.fullmatch(slot_id) or slot_id in seen_credential_slots:
                raise ExtensionManifestError("invalid_credential_slot_id")
            if not label or len(label) > 80 or len(description) > 240:
                raise ExtensionManifestError("invalid_credential_slot_text")
            seen_credential_slots.add(slot_id)
            credential_slots.append({
                "id": slot_id,
                "slotId": f"ext.{package_id}.{slot_id}",
                "label": label,
                "description": description,
            })

        return ExtensionPackage(
            id=package_id,
            name=name,
            version=version,
            description=description,
            type=package_type,
            risk_level=risk_level,
            capabilities=capabilities,
            default_enabled=bool(data.get("defaultEnabled", False)) if source == "bundled" else False,
            theme_tokens=theme_tokens,
            office_templates=office_templates,
            skills=tuple(skills),
            credential_slots=tuple(credential_slots),
            source=source,
            manifest_path=str(resolved),
            content_hash=hashlib.sha256(raw + b''.join(file_material)).hexdigest(),
        )
