"""Persistent, dependency-free local agent runtime for Hermes Project 5."""

from __future__ import annotations

import json
import os
import html
import base64
import binascii
import hashlib
import ipaddress
import re
import shutil
import socket
import sqlite3
import subprocess
import sys
import threading
import urllib.error
import urllib.parse
import urllib.request
import uuid
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable
from html.parser import HTMLParser

from agent_tools import ToolRegistry
from persona_modes import role_mode,checked_mode
from agent_tool_catalog import MODEL_TOOL_NAMES
from agent_execution import AgentExecutor
from agent_tasks import TaskHistory
from approval_runtime import ApprovalRuntime
from character_task_policy import normalize_character_profile, build_character_task_messages, prepare_character_proposal
from extension_runtime import ExtensionCatalog, ExtensionRegistry
from office_runtime import OfficeRuntime
from runtime_backup import RuntimeBackupManager
from remote_mcp import RemoteMCP
from companion_features import CompanionFeatures
from auto_moments import AutoMoments
from role_workspace import RoleWorkspace
from role_skills import RoleSkills, RoleSkillTurn


TEXT_GLOBS = ("*.md", "*.txt", "*.json", "*.jsonl", "*.yaml", "*.yml", "*.py", "*.js", "*.ts", "*.html")
MAX_WEB_BYTES = 524_288
MAX_MODEL_BYTES = 1_048_576
MAX_PROVIDER_REQUEST_BYTES = 24 * 1_048_576
MAX_IMAGE_RESPONSE_BYTES = 24 * 1_048_576
MAX_AUDIO_RESPONSE_BYTES = 24 * 1_048_576
MAX_VISION_IMAGE_BYTES = 6 * 1_048_576
MAX_VISION_TOTAL_BYTES = 16 * 1_048_576
VISION_MIME_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif"}
MODEL_AGENT_TOOLS = frozenset(MODEL_TOOL_NAMES)
MEMORY_STATUSES = {"active", "archived", "contradicted", "deleted"}
MEMORY_RELATION_TYPES = {"supersedes"}
MEMORY_RELATION_REASONS = {"user_correction", "newer_preference", "source_dispute", "duplicate"}
MEMORY_RELATION_STATUSES = {"resolved", "reopened"}
ACCEPTANCE_CHANNELS = {"chat", "image", "search"}
WORK_ITEM_KINDS = {"general", "research", "office", "character_design", "worldbook_design"}
WORK_ITEM_STATUSES = {
    "draft", "active", "waiting_user", "waiting_approval", "blocked",
    "completed", "cancelled", "archived",
}
WORK_ITEM_TERMINAL_STATUSES = {"completed", "cancelled", "archived"}
WORK_ITEM_CREATORS = {"user", "creator_chat", "system_migration"}
WORK_ITEM_TRANSITIONS = {
    "draft": {"active", "cancelled"},
    "active": {"waiting_user", "waiting_approval", "blocked", "completed", "cancelled"},
    "waiting_user": {"active", "blocked", "cancelled"},
    "waiting_approval": {"active", "blocked", "cancelled"},
    "blocked": {"active", "cancelled", "archived"},
    "completed": {"active", "archived"},
    "cancelled": {"archived"},
    "archived": set(),
}
WORK_ITEM_STEP_KINDS = {
    "research", "approval", "tool", "review", "manual", "publish",
    "character_design", "worldbook_design", "office", "schedule",
}
WORK_ITEM_STEP_STATUSES = {"pending", "active", "completed", "blocked", "cancelled"}
WORK_ITEM_STEP_TRANSITIONS = {
    "pending": {"active", "cancelled"},
    "active": {"completed", "blocked", "cancelled"},
    "blocked": {"active", "cancelled"},
    "completed": set(),
    "cancelled": set(),
}
WORK_ITEM_SOURCE_KINDS = {
    "pasted_text", "local_file", "url", "character_card", "worldbook", "memory",
}
WORK_ITEM_SOURCE_PROVENANCE = {
    "user_supplied", "public_reference", "licensed_reuse", "unknown",
}
WORK_ITEM_SOURCE_SENSITIVITY = {"private", "shared", "public"}
WORK_ITEM_SOURCE_STATUSES = {"active", "missing", "error"}
WORK_ITEM_ARTIFACT_KINDS = {
    "character_bible", "character_card", "worldbook", "relationship_rules",
    "report", "document", "spreadsheet", "presentation", "image_set",
}
LIFE_VISIBILITIES = {"private", "shared", "all-characters"}
MOMENT_STATUSES = {"draft", "published", "failed"}
MOMENT_TEXT_MAX = 4000
MOMENT_MEDIA_MAX = 8
MOMENT_SOURCE_MAX = 32
MOMENT_PAGE_MAX = 100
WORK_ITEM_ARTIFACT_STATUSES = {"draft", "published", "archived"}
ARTIFACT_REVISION_VALIDATION_STATUSES = {
    "pending", "valid", "invalid", "approved", "rejected",
}
WORK_ITEM_CONVERSATION_MODES = {"creator", "character"}
WORK_ITEM_JSON_MAX_BYTES = 32_768
WORK_ITEM_SOURCE_IDS_MAX = 100


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []
        self.title = ""
        self._in_title = False
        self._ignored = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"script", "style", "svg", "noscript"}:
            self._ignored += 1
        if tag == "title":
            self._in_title = True

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style", "svg", "noscript"} and self._ignored:
            self._ignored -= 1
        if tag == "title":
            self._in_title = False

    def handle_data(self, data: str) -> None:
        if self._ignored:
            return
        value = " ".join(data.split())
        if not value:
            return
        if self._in_title:
            self.title = f"{self.title} {value}".strip()
        self.parts.append(value)


class PublicHttpsRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        validate_public_https(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


class DenyRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise PermissionError("provider_redirect_blocked")


class ProviderHTTPError(Exception):
    def __init__(self, status: int, detail: str = "", request_id: str = "") -> None:
        super().__init__(detail or f"HTTP {status}")
        self.status = status
        self.detail = detail or f"HTTP {status}"
        self.request_id = request_id


def validate_public_https(url: str) -> urllib.parse.ParseResult:
    parsed = urllib.parse.urlparse(url.strip())
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise PermissionError("public_https_url_required")
    try:
        addresses = {item[4][0] for item in socket.getaddrinfo(parsed.hostname, 443, type=socket.SOCK_STREAM)}
    except socket.gaierror as error:
        raise ValueError("web_host_unresolved") from error
    for address in addresses:
        ip = ipaddress.ip_address(address.split("%")[0])
        if not ip.is_global:
            raise PermissionError("web_private_address_blocked")
    return parsed




def validate_provider_url(url):
    parsed=urllib.parse.urlparse(url)
    if parsed.scheme in {'http','https'} and parsed.hostname in {'127.0.0.1','::1'} and not parsed.username and not parsed.password and not parsed.query and not parsed.fragment:
        origin=f'{parsed.scheme}://{parsed.netloc}'
        allowed={v.strip().rstrip('/') for v in os.environ.get('HERMES_TRUSTED_LOCAL_PROVIDER_ORIGINS','').split(',') if v.strip()}
        if origin in allowed:return parsed
    return validate_public_https(url)


class AgentRuntime:
    schema_version = 14

    def __init__(self, data_dir: Path, knowledge_roots: list[Path], extension_root: Path | None = None) -> None:
        self.data_dir = data_dir.resolve()
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.db_path = self.data_dir / "hermes_agent.db"
        self.knowledge_roots = list(dict.fromkeys(root.resolve() for root in knowledge_roots if root.exists()))
        self.extension_root = (extension_root or Path(__file__).resolve().parent / "extensions").resolve()
        self.user_extension_root = (self.data_dir / "extensions").resolve()
        self.user_extension_root.mkdir(parents=True, exist_ok=True)
        self.extension_registry = ExtensionRegistry(self.extension_root, self.user_extension_root)
        self.extension_catalog: ExtensionCatalog = self.extension_registry.scan()
        self.office_runtime = OfficeRuntime(self.data_dir / "office", self.knowledge_roots)
        self.registry = ToolRegistry()
        self._stop = threading.Event()
        self._scheduler: threading.Thread | None = None
        self._run_lock = threading.Lock()
        self._run_status: dict[str, dict[str, Any]] = {}
        self._run_cancel: dict[str, threading.Event] = {}
        self.backup_manager = RuntimeBackupManager(self.db_path, schema_version=self.schema_version)
        self.backup_manager.prepare_primary()
        self._init_database()
        from worldbook_runtime import WorldbookRuntime
        from reasoning_translation import ReasoningTranslations
        self.worldbooks=WorldbookRuntime(Path(__file__).parent,self.data_dir)
        self.reasoning_translations=ReasoningTranslations(self)
        self.approvals = ApprovalRuntime(self.db_path)
        self.remote_mcp = RemoteMCP(self.data_dir / "mcp-servers.json", on_change=self.backup_manager.mark_dirty)
        self._sync_extension_state()
        self.recovered_interrupted_tasks = self._recover_interrupted_tasks()
        self.companion_features = CompanionFeatures(self)
        self.auto_moments = AutoMoments(self)
        self.role_workspace = RoleWorkspace(self)
        from temporary_places import TemporaryPlaces
        self.temporary_places = TemporaryPlaces(self)
        from world_life import WorldLife
        self.world_life = WorldLife(self)
        from moment_reactions import MomentReactions
        self.moment_reactions = MomentReactions(self)
        from character_events import CharacterEvents
        self.character_events = CharacterEvents(self)
        from phone_groups import PhoneGroups
        self.phone_groups = PhoneGroups(self)
        from play_runs import PlayRuns
        self.play_runs = PlayRuns(self)
        self.role_skills = RoleSkills(self)
        self._register_tools()
        try:
            self.backup_manager.create_snapshot("startup")
        except (OSError, RuntimeError, sqlite3.DatabaseError):
            pass

    def connect(self) -> sqlite3.Connection:
        database = sqlite3.connect(self.db_path, timeout=10)
        database.row_factory = sqlite3.Row
        database.execute("PRAGMA foreign_keys=ON")
        database.execute("PRAGMA journal_mode=WAL")
        database.set_trace_callback(self._track_sql_mutation)
        return database

    def _track_sql_mutation(self, statement: str) -> None:
        operation = str(statement or "").lstrip().split(None, 1)[0].upper()
        if operation in {"ALTER", "CREATE", "DELETE", "DROP", "INSERT", "REPLACE", "UPDATE"}:
            self.backup_manager.mark_dirty()

    def _init_database(self) -> None:
        with closing(self.connect()) as database, database:
            database.executescript("""
                BEGIN IMMEDIATE;
                CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS memories(
                    id TEXT PRIMARY KEY,role_id TEXT NOT NULL,kind TEXT NOT NULL,content TEXT NOT NULL,
                    source TEXT NOT NULL,confidence REAL NOT NULL,status TEXT NOT NULL,
                    created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS memories_lookup ON memories(role_id,status,updated_at DESC);
                CREATE TABLE IF NOT EXISTS memory_relations(
                    id TEXT PRIMARY KEY,role_id TEXT NOT NULL,subject_id TEXT NOT NULL,
                    object_id TEXT NOT NULL,relation_type TEXT NOT NULL,reason_code TEXT NOT NULL,
                    status TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
                    UNIQUE(subject_id,object_id,relation_type));
                CREATE INDEX IF NOT EXISTS memory_relations_role
                    ON memory_relations(role_id,status,updated_at DESC);
                CREATE TABLE IF NOT EXISTS conversation_messages(
                    id TEXT PRIMARY KEY,session_id TEXT NOT NULL,role_id TEXT NOT NULL,
                    ordinal INTEGER NOT NULL,sender TEXT NOT NULL,text TEXT NOT NULL,
                    tone TEXT NOT NULL,attachments_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,deleted_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS conversation_scene_notices(
                    message_id TEXT PRIMARY KEY,codes_json TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS conversation_reasoning(
                    message_id TEXT PRIMARY KEY,text TEXT NOT NULL,truncated INTEGER NOT NULL DEFAULT 0);
                CREATE INDEX IF NOT EXISTS conversation_messages_session
                    ON conversation_messages(role_id,session_id,deleted_at,ordinal,id);
                DROP INDEX IF EXISTS conversation_messages_ordinal;
                CREATE UNIQUE INDEX conversation_messages_ordinal
                    ON conversation_messages(role_id,session_id,ordinal) WHERE deleted_at='';
                CREATE TABLE IF NOT EXISTS tasks(
                    id TEXT PRIMARY KEY,role_id TEXT NOT NULL,title TEXT NOT NULL,tool_name TEXT NOT NULL,
                    status TEXT NOT NULL,input_json TEXT NOT NULL,output_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,finished_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS schedules(
                    id TEXT PRIMARY KEY,role_id TEXT NOT NULL,title TEXT NOT NULL,note TEXT NOT NULL,
                    due_at TEXT NOT NULL,lead_minutes INTEGER NOT NULL,status TEXT NOT NULL,
                    notified_at TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS schedules_due ON schedules(status,due_at);
                CREATE TABLE IF NOT EXISTS events(
                    id INTEGER PRIMARY KEY AUTOINCREMENT,type TEXT NOT NULL,role_id TEXT NOT NULL,
                    payload_json TEXT NOT NULL,created_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS proactive_policy(
                    id TEXT PRIMARY KEY,role_id TEXT NOT NULL,enabled INTEGER NOT NULL,quiet_start TEXT NOT NULL,
                    quiet_end TEXT NOT NULL,minimum_interval_minutes INTEGER NOT NULL,
                    daily_cap INTEGER NOT NULL,unanswered_limit INTEGER NOT NULL,
                    unanswered_cooldown_minutes INTEGER NOT NULL,updated_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS proactive_receipts(
                    id TEXT PRIMARY KEY,role_id TEXT NOT NULL,reason TEXT NOT NULL,
                    decision TEXT NOT NULL,response_state TEXT NOT NULL,
                    next_eligible_at TEXT NOT NULL,created_at TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS proactive_receipts_recent
                    ON proactive_receipts(role_id,created_at DESC);
                CREATE TABLE IF NOT EXISTS extension_state(
                    id TEXT PRIMARY KEY,enabled INTEGER NOT NULL,updated_at TEXT NOT NULL,
                    content_hash TEXT NOT NULL DEFAULT '',reviewed_hash TEXT NOT NULL DEFAULT '');
                CREATE TABLE IF NOT EXISTS provider_acceptance_receipts(
                    channel TEXT PRIMARY KEY,receipt_json TEXT NOT NULL,
                    accepted_at TEXT NOT NULL,updated_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS work_items(
                    id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,kind TEXT NOT NULL,
                    title TEXT NOT NULL,summary TEXT NOT NULL DEFAULT '',status TEXT NOT NULL,
                    priority INTEGER NOT NULL DEFAULT 0,character_id TEXT NOT NULL DEFAULT '',
                    active_step_id TEXT NOT NULL DEFAULT '',created_by TEXT NOT NULL,
                    created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
                    completed_at TEXT NOT NULL DEFAULT '',archived_at TEXT NOT NULL DEFAULT '');
                CREATE TABLE IF NOT EXISTS work_item_steps(
                    id TEXT PRIMARY KEY,work_item_id TEXT NOT NULL REFERENCES work_items(id),
                    ordinal INTEGER NOT NULL,kind TEXT NOT NULL,title TEXT NOT NULL,
                    status TEXT NOT NULL,owner TEXT NOT NULL,task_id TEXT NOT NULL DEFAULT '',
                    agent_run_id TEXT NOT NULL DEFAULT '',input_json TEXT NOT NULL DEFAULT '{}',
                    result_summary TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,UNIQUE(work_item_id,ordinal));
                CREATE TABLE IF NOT EXISTS work_item_events(
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    work_item_id TEXT NOT NULL REFERENCES work_items(id),
                    step_id TEXT NOT NULL DEFAULT '',event_key TEXT NOT NULL UNIQUE,
                    request_hash TEXT NOT NULL,type TEXT NOT NULL,actor TEXT NOT NULL,
                    payload_json TEXT NOT NULL,created_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS work_item_sources(
                    id TEXT PRIMARY KEY,work_item_id TEXT NOT NULL REFERENCES work_items(id),
                    kind TEXT NOT NULL,title TEXT NOT NULL,origin TEXT NOT NULL DEFAULT '',
                    content_ref TEXT NOT NULL DEFAULT '',content_hash TEXT NOT NULL DEFAULT '',
                    provenance TEXT NOT NULL,sensitivity TEXT NOT NULL,status TEXT NOT NULL,
                    created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS work_item_artifacts(
                    id TEXT PRIMARY KEY,work_item_id TEXT NOT NULL REFERENCES work_items(id),
                    kind TEXT NOT NULL,title TEXT NOT NULL,status TEXT NOT NULL,
                    current_revision_id TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS artifact_revisions(
                    id TEXT PRIMARY KEY,artifact_id TEXT NOT NULL REFERENCES work_item_artifacts(id),
                    parent_revision_id TEXT NOT NULL DEFAULT '',format TEXT NOT NULL,
                    content_ref TEXT NOT NULL DEFAULT '',content_hash TEXT NOT NULL,
                    content_json TEXT NOT NULL DEFAULT '',
                    author TEXT NOT NULL,validation_status TEXT NOT NULL,
                    source_ids_json TEXT NOT NULL DEFAULT '[]',published INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS work_item_schedule_links(
                    work_item_id TEXT NOT NULL REFERENCES work_items(id),
                    schedule_id TEXT NOT NULL REFERENCES schedules(id),relation TEXT NOT NULL,
                    created_at TEXT NOT NULL,PRIMARY KEY(work_item_id,schedule_id,relation));
                CREATE TABLE IF NOT EXISTS work_item_conversation_links(
                    work_item_id TEXT NOT NULL REFERENCES work_items(id),session_id TEXT NOT NULL,
                    role_id TEXT NOT NULL,mode TEXT NOT NULL,relation TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    PRIMARY KEY(work_item_id,session_id,role_id,mode,relation));
                CREATE TABLE IF NOT EXISTS work_item_idempotency(
                    key TEXT PRIMARY KEY,operation TEXT NOT NULL,request_hash TEXT NOT NULL,
                    result_json TEXT NOT NULL,created_at TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS work_items_workspace_status
                    ON work_items(workspace_id,status,created_at,id);
                CREATE INDEX IF NOT EXISTS work_items_kind_status
                    ON work_items(kind,status,created_at,id);
                CREATE INDEX IF NOT EXISTS work_item_steps_order
                    ON work_item_steps(work_item_id,ordinal);
                CREATE UNIQUE INDEX IF NOT EXISTS work_item_steps_one_active
                    ON work_item_steps(work_item_id) WHERE status='active';
                CREATE INDEX IF NOT EXISTS work_item_events_order
                    ON work_item_events(work_item_id,id);
                CREATE INDEX IF NOT EXISTS work_item_sources_parent
                    ON work_item_sources(work_item_id);
                CREATE INDEX IF NOT EXISTS work_item_sources_page
                    ON work_item_sources(work_item_id,created_at,id);
                CREATE INDEX IF NOT EXISTS work_item_artifacts_parent
                    ON work_item_artifacts(work_item_id);
                CREATE INDEX IF NOT EXISTS work_item_artifacts_page
                    ON work_item_artifacts(work_item_id,created_at,id);
                CREATE UNIQUE INDEX IF NOT EXISTS artifact_revisions_content_hash
                    ON artifact_revisions(artifact_id,content_hash);
                CREATE INDEX IF NOT EXISTS work_item_conversation_session
                    ON work_item_conversation_links(session_id,role_id,mode);
                CREATE TABLE IF NOT EXISTS life_events(
                    id TEXT PRIMARY KEY,source_type TEXT NOT NULL,source_id TEXT NOT NULL,
                    role_id TEXT NOT NULL,visibility TEXT NOT NULL,payload_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,consumed_at TEXT NOT NULL DEFAULT '',deleted_at TEXT NOT NULL DEFAULT '',
                    UNIQUE(source_type,source_id,role_id));
                CREATE INDEX IF NOT EXISTS life_events_feed
                    ON life_events(visibility,deleted_at,created_at,id);
                CREATE TABLE IF NOT EXISTS moments(
                    id TEXT PRIMARY KEY,author_id TEXT NOT NULL,visibility TEXT NOT NULL,text TEXT NOT NULL,
                    source_event_ids_json TEXT NOT NULL,media_json TEXT NOT NULL,status TEXT NOT NULL,
                    created_at TEXT NOT NULL,published_at TEXT NOT NULL DEFAULT '',deleted_at TEXT NOT NULL DEFAULT '');
                CREATE INDEX IF NOT EXISTS moments_feed
                    ON moments(visibility,deleted_at,published_at,created_at,id);
                CREATE TABLE IF NOT EXISTS moment_comments(
                    id TEXT PRIMARY KEY,moment_id TEXT NOT NULL REFERENCES moments(id),author_id TEXT NOT NULL,
                    text TEXT NOT NULL,metadata_json TEXT NOT NULL,due_at TEXT NOT NULL,created_at TEXT NOT NULL,
                    published_at TEXT NOT NULL DEFAULT '',deleted_at TEXT NOT NULL DEFAULT '');
                CREATE INDEX IF NOT EXISTS moment_comments_due
                    ON moment_comments(published_at,deleted_at,due_at,id);
            """)
            extension_columns = {row[1] for row in database.execute("PRAGMA table_info(extension_state)").fetchall()}
            if "content_hash" not in extension_columns:
                database.execute("ALTER TABLE extension_state ADD COLUMN content_hash TEXT NOT NULL DEFAULT ''")
            if "reviewed_hash" not in extension_columns:
                database.execute("ALTER TABLE extension_state ADD COLUMN reviewed_hash TEXT NOT NULL DEFAULT ''")
            artifact_revision_columns = {
                row[1] for row in database.execute("PRAGMA table_info(artifact_revisions)").fetchall()
            }
            if "content_json" not in artifact_revision_columns:
                database.execute(
                    "ALTER TABLE artifact_revisions ADD COLUMN content_json TEXT NOT NULL DEFAULT ''"
                )
            database.execute(
                """INSERT OR IGNORE INTO proactive_policy VALUES(?,?,?,?,?,?,?,?,?,?)""",
                ("default", "shira", 1, "23:00", "08:00", 180, 3, 2, 1440, utc_now()),
            )
            database.execute(
                "INSERT INTO metadata(key,value) VALUES('schema_version',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (str(self.schema_version),),
            )

    def _register_tools(self) -> None:
        @self.registry.register('worldbook_catalog','Read the shared world and presentation data pack snapshot.')
        def worldbook_catalog(args):return self.worldbook_for_mode(args.get('personaMode','normal')).catalog(force=args.get('force') is True)
        @self.registry.register('worldbook_scene_get','Read one authored scene by stable ID or an unambiguous keyword; owner UI only.')
        def worldbook_scene_get(args):return self.worldbook_for_mode(args.get('personaMode','normal')).scene_record(args)
        @self.registry.register('temporary_place_list','Owner UI: read this role/session fictional places.')
        def temporary_place_list(args):return self.temporary_places.list(args)
        @self.registry.register('temporary_place_upsert','Owner UI: register a generated location, separate from memory.',mutating=True)
        def temporary_place_upsert(args):return self.temporary_places.upsert(args)
        @self.registry.register('temporary_place_change','Owner UI: save or remove a temporary location.',mutating=True)
        def temporary_place_change(args):return self.temporary_places.change(args)
        @self.registry.register('worldbook_import','Validate and install a JSON world/presentation data pack.',mutating=True)
        def worldbook_import(args):return self.worldbook_for_mode(args.get('personaMode','normal')).import_pack(args)
        @self.registry.register('worldbook_pack_get','Read one installed JSON data pack.')
        def worldbook_pack_get(args):return self.worldbook_for_mode(args.get('personaMode','normal')).get_pack(args)
        @self.registry.register('worldbook_remove','Uninstall a data pack with a recoverable backup.',mutating=True)
        def worldbook_remove(args):return self.worldbook_for_mode(args.get('personaMode','normal')).remove_pack(args)
        @self.registry.register("knowledge_search", "Search approved local knowledge roots and return cited excerpts.")
        def knowledge_search(args: dict[str, Any]) -> dict[str, Any]:
            paths = args.get("paths") if isinstance(args.get("paths"), list) else []
            return self.search_knowledge(str(args.get("query") or ""), int(args.get("limit") or 6), paths)

        @self.registry.register("memory_save", "Save a typed durable memory.", mutating=True)
        def memory_save(args: dict[str, Any]) -> dict[str, Any]:
            return self.save_memory(args)

        @self.registry.register("life_event_append", "Append one factual local life event.", mutating=True)
        def life_event_append(args: dict[str, Any]) -> dict[str, Any]:
            return self.append_life_event(args)

        @self.registry.register("life_event_list", "List factual local life events.")
        def life_event_list(args: dict[str, Any]) -> dict[str, Any]:
            return self.list_life_events(args)

        @self.registry.register("moment_create", "Create one local moment draft or post.", mutating=True)
        def moment_create(args: dict[str, Any]) -> dict[str, Any]:
            return self.create_moment(args)

        @self.registry.register("moment_list", "List visible local moments and published comments.")
        def moment_list(args: dict[str, Any]) -> dict[str, Any]:
            return self.list_moments(args)

        @self.registry.register("moment_comment_schedule", "Schedule one delayed local moment comment.", mutating=True)
        def moment_comment_schedule(args: dict[str, Any]) -> dict[str, Any]:
            return self.schedule_moment_comment(args)

        @self.registry.register("moment_tick", "Publish due local moment comments idempotently.", mutating=True)
        def moment_tick(args: dict[str, Any]) -> dict[str, Any]:
            return self.tick_moments(args)

        @self.registry.register("moment_tombstone", "Tombstone one local moment.", mutating=True)
        def moment_tombstone(args: dict[str, Any]) -> dict[str, Any]:
            return self.tombstone_moment(args)

        @self.registry.register("memory_search", "Retrieve active durable memories.")
        def memory_search(args: dict[str, Any]) -> dict[str, Any]:
            return self.search_memories(str(args.get("query") or ""), str(args.get("roleId") or ""), int(args.get("limit") or 8))

        @self.registry.register("conversation_search", "Search this role's original conversation evidence; summaries are not proof.")
        def conversation_search(args: dict[str, Any]) -> dict[str, Any]:
            return self.role_workspace.search(args)

        @self.registry.register("memory_conflict_list", "List user-resolved memory conflicts and provenance.")
        def memory_conflict_list(args: dict[str, Any]) -> dict[str, Any]:
            return self.list_memory_conflicts(
                str(args.get("roleId") or ""), str(args.get("status") or ""), int(args.get("limit") or 50)
            )

        @self.registry.register("memory_conflict_resolve", "Resolve a memory conflict with explicit provenance.", mutating=True)
        def memory_conflict_resolve(args: dict[str, Any]) -> dict[str, Any]:
            return self.resolve_memory_conflict(args)

        @self.registry.register("memory_conflict_reopen", "Reopen a resolved memory conflict.", mutating=True)
        def memory_conflict_reopen(args: dict[str, Any]) -> dict[str, Any]:
            return self.reopen_memory_conflict(args)

        @self.registry.register("conversation_sync", "Idempotently persist a bounded local conversation transcript.", mutating=True)
        def conversation_sync(args: dict[str, Any]) -> dict[str, Any]:
            return self.sync_conversation(args)

        @self.registry.register("conversation_list", "List active messages for one local role session.")
        def conversation_list(args: dict[str, Any]) -> dict[str, Any]:
            return self.list_conversation(
                str(args.get("roleId") or ""), str(args.get("sessionId") or ""),
                int(args.get("limit") or 500), int(args.get("afterOrdinal") if args.get("afterOrdinal") is not None else -1)
            )

        @self.registry.register("conversation_clear", "Tombstone one local role conversation.", mutating=True)
        def conversation_clear(args: dict[str, Any]) -> dict[str, Any]:
            return self.clear_conversation(args)

        @self.registry.register("work_item_create", "Create one durable work item.", mutating=True)
        def work_item_create(args: dict[str, Any]) -> dict[str, Any]:
            return self.create_work_item(args)

        @self.registry.register("work_item_get", "Read one durable work item.")
        def work_item_get(args: dict[str, Any]) -> dict[str, Any]:
            return self.get_work_item(args)

        @self.registry.register("work_item_list", "List durable work items with bounded pagination.")
        def work_item_list(args: dict[str, Any]) -> dict[str, Any]:
            return self.list_work_items(args)

        @self.registry.register("work_item_transition", "Compare-and-set one work-item state.", mutating=True)
        def work_item_transition(args: dict[str, Any]) -> dict[str, Any]:
            return self.transition_work_item(args)

        @self.registry.register("work_item_event_list", "List append-only work-item events.")
        def work_item_event_list(args: dict[str, Any]) -> dict[str, Any]:
            return self.list_work_item_events(args)

        @self.registry.register("work_item_step_create", "Create one ordered work-item step.", mutating=True)
        def work_item_step_create(args: dict[str, Any]) -> dict[str, Any]:
            return self.create_work_item_step(args)

        @self.registry.register("work_item_step_transition", "Compare-and-set one work-item step state.", mutating=True)
        def work_item_step_transition(args: dict[str, Any]) -> dict[str, Any]:
            return self.transition_work_item_step(args)

        @self.registry.register("work_item_source_attach", "Attach source metadata to one work item.", mutating=True)
        def work_item_source_attach(args: dict[str, Any]) -> dict[str, Any]:
            return self.attach_work_item_source(args)

        @self.registry.register("work_item_source_list", "List source metadata for one work item.")
        def work_item_source_list(args: dict[str, Any]) -> dict[str, Any]:
            return self.list_work_item_sources(args)

        @self.registry.register("work_item_artifact_create", "Create one work-item artifact.", mutating=True)
        def work_item_artifact_create(args: dict[str, Any]) -> dict[str, Any]:
            return self.create_work_item_artifact(args)

        @self.registry.register("artifact_revision_create", "Append one immutable artifact revision.", mutating=True)
        def artifact_revision_create(args: dict[str, Any]) -> dict[str, Any]:
            return self.create_artifact_revision(args)

        @self.registry.register("artifact_revision_content_get", "Read durable content for one artifact revision.")
        def artifact_revision_content_get(args: dict[str, Any]) -> dict[str, Any]:
            return self.get_artifact_revision_content(args)

        @self.registry.register("work_item_artifact_list", "List artifacts for one work item.")
        def work_item_artifact_list(args: dict[str, Any]) -> dict[str, Any]:
            return self.list_work_item_artifacts(args)

        @self.registry.register("work_item_schedule_link", "Link one existing schedule by identifier.", mutating=True)
        def work_item_schedule_link(args: dict[str, Any]) -> dict[str, Any]:
            return self.link_work_item_schedule(args)

        @self.registry.register("work_item_conversation_link", "Link conversation metadata to one work item.", mutating=True)
        def work_item_conversation_link(args: dict[str, Any]) -> dict[str, Any]:
            return self.link_work_item_conversation(args)

        @self.registry.register("schedule_upsert", "Create or update a durable schedule.", mutating=True)
        def schedule_upsert(args: dict[str, Any]) -> dict[str, Any]:
            return self.upsert_schedule(args)

        @self.registry.register("schedule_list", "List durable schedules.")
        def schedule_list(args: dict[str, Any]) -> dict[str, Any]:
            return {"items": self.list_schedules(str(args.get("roleId") or ""))}

        @self.registry.register("proactive_config", "Persist guarded proactive-message policy.", mutating=True)
        def proactive_config(args: dict[str, Any]) -> dict[str, Any]:
            return self.upsert_proactive_policy(args)

        @self.registry.register("proactive_check", "Evaluate and reserve a guarded proactive message.", mutating=True)
        def proactive_check(args: dict[str, Any]) -> dict[str, Any]:
            return self.evaluate_proactive(args)

        @self.registry.register("proactive_ack", "Mark the latest proactive message as answered.", mutating=True)
        def proactive_ack(args: dict[str, Any]) -> dict[str, Any]:
            return self.acknowledge_proactive(str(args.get("roleId") or ""))

        @self.registry.register("extension_list", "List validated local plugin and theme packages.")
        def extension_list(args: dict[str, Any]) -> dict[str, Any]:
            return self.list_extensions(refresh=bool(args.get("refresh", False)))

        @self.registry.register("extension_set_enabled", "Enable or disable a validated local package.", mutating=True)
        def extension_set_enabled(args: dict[str, Any]) -> dict[str, Any]:
            return self.set_extension_enabled(str(args.get("id") or ""), args.get("enabled"))

        @self.registry.register("office_workspace_inventory", "List Office files in approved workspace roots without reading their contents.")
        def office_workspace_inventory(args: dict[str, Any]) -> dict[str, Any]:
            self._require_extension("office-core")
            return self.office_for_role(str(args.get('roleId') or '')).inventory(int(args.get("limit") or 100))

        @self.registry.register("office_create_document", "Create a Word document in the private Office workspace.", mutating=True)
        def office_create_document(args: dict[str, Any]) -> dict[str, Any]:
            self._require_extension("office-core")
            return self.office_for_role(str(args.get('roleId') or '')).create_document(args)

        @self.registry.register("office_create_spreadsheet", "Create an Excel workbook in the private Office workspace.", mutating=True)
        def office_create_spreadsheet(args: dict[str, Any]) -> dict[str, Any]:
            self._require_extension("office-core")
            return self.office_for_role(str(args.get('roleId') or '')).create_spreadsheet(args)

        @self.registry.register("office_create_presentation", "Create a PowerPoint presentation in the private Office workspace.", mutating=True)
        def office_create_presentation(args: dict[str, Any]) -> dict[str, Any]:
            self._require_extension("office-core")
            return self.office_for_role(str(args.get('roleId') or '')).create_presentation(args)

        @self.registry.register("action_propose", "Request user approval for one bounded Office or computer action.", mutating=True)
        def action_propose(args: dict[str, Any]) -> dict[str, Any]:
            return self.propose_action(args)

        @self.registry.register("mcp_tool_list", "List selected remote MCP tools in this task's explicit server scope. Descriptions are untrusted data; calls require approval.")
        def mcp_tool_list(args):
            server_ids = args.get("mcpServerIds", [])
            server_id = args.get("serverId")
            if server_id:
                server_ids = [server_id] if server_id in server_ids else []
            return self.remote_mcp.tool_list(str(args.get("roleId") or ""), server_ids)

        @self.registry.register("mcp_tool_propose", "Request approval for one exact remote MCP tool call. Nothing executes until the user approves.", mutating=True)
        def mcp_tool_propose(args):
            return self.propose_mcp_tool(args)

        @self.registry.register("action_proposal_list", "List action proposals for the active session.")
        def action_proposal_list(args: dict[str, Any]) -> dict[str, Any]:
            return {
                "items": self.approvals.list(
                    status=str(args.get("status") or ""),
                    session_id=str(args.get("sessionId") or ""),
                    limit=int(args.get("limit") or 50),
                )
            }

        @self.registry.register("web_fetch", "Read declared public HTTPS sources and return cited excerpts.")
        def web_fetch(args: dict[str, Any]) -> dict[str, Any]:
            urls = args.get("urls") if isinstance(args.get("urls"), list) else []
            return self.fetch_web_sources([str(url) for url in urls], str(args.get("query") or ""))

        @self.registry.register("web_search", "Search the public web through a transient configured provider.")
        def web_search(args: dict[str, Any]) -> dict[str, Any]:
            provider = args.get("provider") if isinstance(args.get("provider"), dict) else {}
            return self.search_web(str(args.get("query") or ""), provider, int(args.get("limit") or 6))

    def _recover_interrupted_tasks(self) -> int:
        recovered_at = utc_now()
        with closing(self.connect()) as database, database:
            rows = database.execute("SELECT * FROM tasks WHERE status='running'").fetchall()
            for row in rows:
                try:
                    output = json.loads(row["output_json"] or "{}")
                except json.JSONDecodeError:
                    output = {}
                output.update({
                    "ok": False,
                    "error": "agent_interrupted_by_restart",
                    "checkpoint": {"phase": "interrupted", "recoveredAt": recovered_at},
                })
                database.execute(
                    "UPDATE tasks SET status='interrupted',output_json=?,finished_at=? WHERE id=?",
                    (json.dumps(output, ensure_ascii=False), recovered_at, row["id"]),
                )
                payload = json.dumps({
                    "taskId": row["id"], "title": row["title"], "tool": row["tool_name"],
                }, ensure_ascii=False)
                database.execute(
                    "INSERT INTO events(type,role_id,payload_json,created_at) VALUES('agent_run_interrupted',?,?,?)",
                    (row["role_id"], payload, recovered_at),
                )
        return len(rows)

    def status(self) -> dict[str, Any]:
        with closing(self.connect()) as database, database:
            counts = {
                table: database.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
                for table in (
                    "memories", "memory_relations", "conversation_messages", "tasks", "schedules",
                    "events", "action_proposals", "action_receipts", "work_items", "work_item_steps",
                    "work_item_events", "work_item_sources", "work_item_artifacts",
                    "life_events", "moments", "moment_comments", "shared_world_state", "character_residences", "moment_audience", "moment_reaction_queue", "moment_role_likes",
                )
            }
        return {
            "ok": True, "service": "hermes-agent-runtime", "schemaVersion": self.schema_version,
            "database": str(self.db_path), "knowledgeRoots": [str(root) for root in self.knowledge_roots],
            "tools": self.registry.definitions(), "counts": counts,
            "proactive": self.proactive_status(), "extensions": self.extension_status(),
            "backup": self.backup_manager.status(),
            "scheduler": bool(self._scheduler and self._scheduler.is_alive()),
            "recoveredInterruptedTasks": self.recovered_interrupted_tasks,
            "recoveredApprovalExecutions": self.approvals.recovered_executing,
        }

    def _emit_event(self, event_type: str, role_id: str, payload: dict[str, Any]) -> None:
        with closing(self.connect()) as database, database:
            database.execute(
                "INSERT INTO events(type,role_id,payload_json,created_at) VALUES(?,?,?,?)",
                (event_type, role_id or "shared", json.dumps(payload, ensure_ascii=False), utc_now()),
            )

    def _work_item_request_hash(self, operation: str, payload: dict[str, Any]) -> str:
        try:
            canonical = json.dumps(
                {"operation": operation, "payload": payload},
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
        except UnicodeEncodeError as error:
            raise ValueError("work_item_unicode_invalid") from error
        return hashlib.sha256(canonical).hexdigest()

    def _work_item_idempotent_result(
        self,
        database: sqlite3.Connection,
        key: str,
        operation: str,
        request_hash: str,
    ) -> dict[str, Any] | None:
        row = database.execute(
            "SELECT operation,request_hash,result_json FROM work_item_idempotency WHERE key=?",
            (key,),
        ).fetchone()
        if row is None:
            return None
        if row["operation"] != operation or row["request_hash"] != request_hash:
            raise ValueError("work_item_idempotency_conflict")
        try:
            result = json.loads(row["result_json"])
        except (TypeError, json.JSONDecodeError) as error:
            raise ValueError("work_item_idempotency_corrupt") from error
        if not isinstance(result, dict):
            raise ValueError("work_item_idempotency_corrupt")
        return {**result, "replayed": True}

    def _record_work_item_idempotency(
        self,
        database: sqlite3.Connection,
        key: str,
        operation: str,
        request_hash: str,
        result: dict[str, Any],
    ) -> None:
        database.execute(
            "INSERT INTO work_item_idempotency VALUES(?,?,?,?,?)",
            (
                key,
                operation,
                request_hash,
                json.dumps(result, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
                utc_now(),
            ),
        )

    @staticmethod
    def _work_item_row(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "workspaceId": row["workspace_id"],
            "kind": row["kind"],
            "title": row["title"],
            "summary": row["summary"],
            "status": row["status"],
            "priority": row["priority"],
            "characterId": row["character_id"],
            "activeStepId": row["active_step_id"],
            "createdBy": row["created_by"],
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
            "completedAt": row["completed_at"],
            "archivedAt": row["archived_at"],
        }

    @staticmethod
    def _work_item_event_row(row: sqlite3.Row) -> dict[str, Any]:
        try:
            payload = json.loads(row["payload_json"] or "{}")
        except json.JSONDecodeError:
            payload = {"error": "event_payload_corrupt"}
        if not isinstance(payload, dict):
            payload = {"value": payload}
        return {
            "id": row["id"],
            "workItemId": row["work_item_id"],
            "stepId": row["step_id"],
            "eventKey": row["event_key"],
            "type": row["type"],
            "actor": row["actor"],
            "payload": payload,
            "createdAt": row["created_at"],
        }

    @staticmethod
    def _work_item_step_row(row: sqlite3.Row) -> dict[str, Any]:
        try:
            input_payload = json.loads(row["input_json"] or "{}")
        except json.JSONDecodeError:
            input_payload = {"error": "step_input_corrupt"}
        if not isinstance(input_payload, dict):
            input_payload = {"value": input_payload}
        return {
            "id": row["id"], "workItemId": row["work_item_id"],
            "ordinal": row["ordinal"], "kind": row["kind"], "title": row["title"],
            "status": row["status"], "owner": row["owner"], "taskId": row["task_id"],
            "agentRunId": row["agent_run_id"], "input": input_payload,
            "resultSummary": row["result_summary"], "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }

    @staticmethod
    def _work_item_source_row(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"], "workItemId": row["work_item_id"], "kind": row["kind"],
            "title": row["title"], "origin": row["origin"],
            "contentRef": row["content_ref"], "contentHash": row["content_hash"],
            "provenance": row["provenance"], "sensitivity": row["sensitivity"],
            "status": row["status"], "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }

    @staticmethod
    def _artifact_revision_row(row: sqlite3.Row) -> dict[str, Any]:
        try:
            source_ids = json.loads(row["source_ids_json"] or "[]")
        except json.JSONDecodeError:
            source_ids = []
        if not isinstance(source_ids, list):
            source_ids = []
        return {
            "id": row["id"], "artifactId": row["artifact_id"],
            "parentRevisionId": row["parent_revision_id"], "format": row["format"],
            "contentRef": row["content_ref"], "contentHash": row["content_hash"],
            "author": row["author"], "validationStatus": row["validation_status"],
            "sourceIds": source_ids, "published": bool(row["published"]),
            "createdAt": row["created_at"],
        }

    @classmethod
    def _work_item_artifact_row(
        cls, row: sqlite3.Row, current_revision: sqlite3.Row | None = None
    ) -> dict[str, Any]:
        return {
            "id": row["id"], "workItemId": row["work_item_id"], "kind": row["kind"],
            "title": row["title"], "status": row["status"],
            "currentRevisionId": row["current_revision_id"],
            "currentRevision": cls._artifact_revision_row(current_revision)
            if current_revision is not None else None,
            "createdAt": row["created_at"], "updatedAt": row["updated_at"],
        }

    @staticmethod
    def _validate_work_item_id(value: Any, field: str) -> str:
        item_id = str(value or "").strip()
        if not item_id:
            raise ValueError(f"{field}_required")
        if len(item_id) > 96 or not re.fullmatch(r"[A-Za-z0-9._:-]+", item_id):
            raise ValueError(f"{field}_invalid")
        return item_id

    @staticmethod
    def _validate_work_item_idempotency_key(value: Any) -> str:
        key = str(value or "").strip()
        if not key:
            raise ValueError("work_item_idempotency_key_required")
        if len(key) < 8 or len(key) > 160 or not re.fullmatch(r"[A-Za-z0-9._:-]+", key):
            raise ValueError("work_item_idempotency_key_invalid")
        return key

    @staticmethod
    def _validate_work_item_limit(value: Any, default: int = 40) -> int:
        raw = default if value is None else value
        if isinstance(raw, bool):
            raise ValueError("work_item_limit_invalid")
        try:
            limit = int(raw)
        except (TypeError, ValueError) as error:
            raise ValueError("work_item_limit_invalid") from error
        if limit < 1 or limit > 100:
            raise ValueError("work_item_limit_invalid")
        return limit

    @staticmethod
    def _validate_work_item_timestamp(value: Any) -> str:
        timestamp = str(value or "").strip()
        try:
            parsed = datetime.fromisoformat(timestamp)
        except ValueError as error:
            raise ValueError("work_item_cursor_invalid") from error
        if parsed.tzinfo is None:
            raise ValueError("work_item_cursor_invalid")
        return timestamp

    @staticmethod
    def _validate_work_item_text(
        value: Any, field: str, maximum: int, *, required: bool = False
    ) -> str:
        text = str(value or "").strip()
        if required and not text:
            raise ValueError(f"{field}_required")
        if len(text) > maximum:
            raise ValueError(f"{field}_too_large")
        try:
            text.encode("utf-8")
        except UnicodeEncodeError as error:
            raise ValueError("work_item_unicode_invalid") from error
        return text

    @staticmethod
    def _validate_work_item_safe_token(
        value: Any, field: str, maximum: int = 64, *, required: bool = True
    ) -> str:
        token = str(value or "").strip()
        if required and not token:
            raise ValueError(f"{field}_required")
        if token and (len(token) > maximum or not re.fullmatch(r"[A-Za-z0-9._:-]+", token)):
            raise ValueError(f"{field}_invalid")
        return token

    @staticmethod
    def _validate_metadata_only_args(args: dict[str, Any], allowed: set[str], error: str) -> None:
        if not isinstance(args, dict) or set(args) - allowed:
            raise ValueError(error)

    @staticmethod
    def _life_timestamp(value: Any, field: str, *, default_now: bool = False) -> str:
        stamp = str(value or (utc_now() if default_now else "")).strip()
        try:
            parsed = datetime.fromisoformat(stamp)
        except ValueError as error:
            raise ValueError(f"{field}_invalid") from error
        if parsed.tzinfo is None:
            raise ValueError(f"{field}_invalid")
        return stamp

    @staticmethod
    def _life_visibility(value: Any) -> str:
        visibility = str(value or "private").strip()
        if visibility not in LIFE_VISIBILITIES:
            raise ValueError("life_visibility_invalid")
        return visibility

    @staticmethod
    def _json_object(value: Any, field: str, maximum: int = 65536) -> str:
        if not isinstance(value, dict):
            raise ValueError(f"{field}_invalid")
        encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        if len(encoded.encode("utf-8")) > maximum:
            raise ValueError(f"{field}_too_large")
        return encoded

    @staticmethod
    def _json_list(value: Any, field: str, maximum_items: int, maximum_bytes: int = 65536) -> str:
        if not isinstance(value, list) or len(value) > maximum_items:
            raise ValueError(f"{field}_invalid")
        encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        if len(encoded.encode("utf-8")) > maximum_bytes:
            raise ValueError(f"{field}_too_large")
        return encoded

    @staticmethod
    def _life_event_row(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"], "sourceType": row["source_type"], "sourceId": row["source_id"],
            "roleId": row["role_id"], "visibility": row["visibility"],
            "payload": json.loads(row["payload_json"]), "createdAt": row["created_at"],
            "consumedAt": row["consumed_at"], "deletedAt": row["deleted_at"],
        }

    @staticmethod
    def _moment_comment_row(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"], "momentId": row["moment_id"], "authorId": row["author_id"],
            "text": row["text"], "metadata": json.loads(row["metadata_json"]),
            "dueAt": row["due_at"], "createdAt": row["created_at"],
            "publishedAt": row["published_at"], "deletedAt": row["deleted_at"],
        }

    @classmethod
    def _moment_row(cls, row: sqlite3.Row, comments: list[sqlite3.Row]) -> dict[str, Any]:
        return {
            "id": row["id"], "authorId": row["author_id"], "visibility": row["visibility"],
            "text": row["text"], "sourceEventIds": json.loads(row["source_event_ids_json"]),
            "media": json.loads(row["media_json"]), "status": row["status"],
            "createdAt": row["created_at"], "publishedAt": row["published_at"],
            "deletedAt": row["deleted_at"],
            "comments": [cls._moment_comment_row(item) for item in comments],
        }

    def append_life_event(self, args: dict[str, Any]) -> dict[str, Any]:
        self._validate_metadata_only_args(
            args, {"id", "sourceType", "sourceId", "roleId", "visibility", "payload", "createdAt"},
            "life_event_fields_invalid",
        )
        event_id = self._validate_work_item_id(args.get("id"), "life_event_id")
        source_type = self._validate_work_item_safe_token(args.get("sourceType"), "life_event_source_type")
        source_id = self._validate_work_item_id(args.get("sourceId"), "life_event_source_id")
        role_id = self._validate_work_item_safe_token(args.get("roleId"), "life_event_role_id")
        visibility = self._life_visibility(args.get("visibility"))
        payload_json = self._json_object(args.get("payload"), "life_event_payload")
        created_at = self._life_timestamp(args.get("createdAt"), "life_event_created_at", default_now=True)
        expected = (event_id, source_type, source_id, role_id, visibility, payload_json, created_at)
        with closing(self.connect()) as database, database:
            existing = database.execute("SELECT * FROM life_events WHERE id=?", (event_id,)).fetchone()
            if existing is not None:
                actual = tuple(existing[key] for key in (
                    "id", "source_type", "source_id", "role_id", "visibility", "payload_json", "created_at"
                ))
                if actual != expected:
                    raise ValueError("life_event_conflict")
                return {"event": self._life_event_row(existing), "replayed": True}
            duplicate = database.execute(
                "SELECT id FROM life_events WHERE source_type=? AND source_id=? AND role_id=?",
                (source_type, source_id, role_id),
            ).fetchone()
            if duplicate is not None:
                raise ValueError("life_event_source_conflict")
            database.execute(
                "INSERT INTO life_events(id,source_type,source_id,role_id,visibility,payload_json,created_at) VALUES(?,?,?,?,?,?,?)",
                expected,
            )
            row = database.execute("SELECT * FROM life_events WHERE id=?", (event_id,)).fetchone()
        return {"event": self._life_event_row(row), "replayed": False}

    def list_life_events(self, args: dict[str, Any]) -> dict[str, Any]:
        self._validate_metadata_only_args(
            args, {"visibility", "viewerRoleId", "limit"}, "life_event_list_fields_invalid"
        )
        visibility = str(args.get("visibility") or "").strip()
        if visibility and visibility not in LIFE_VISIBILITIES:
            raise ValueError("life_visibility_invalid")
        viewer_role_id = self._validate_work_item_safe_token(
            args.get("viewerRoleId"), "life_event_viewer_role_id", required=False
        )
        limit = self._validate_work_item_limit(args.get("limit"), MOMENT_PAGE_MAX)
        clauses = ["deleted_at='' "]
        params: list[Any] = []
        if visibility:
            clauses.append("visibility=?")
            params.append(visibility)
        if viewer_role_id:
            clauses.append("(visibility<>'private' OR role_id=?)")
            params.append(viewer_role_id)
        elif not visibility or visibility == "private":
            clauses.append("visibility<>'private'")
        params.append(limit)
        with closing(self.connect()) as database:
            rows = database.execute(
                f"SELECT * FROM life_events WHERE {' AND '.join(clauses)} ORDER BY created_at DESC,id DESC LIMIT ?",
                tuple(params),
            ).fetchall()
        return {"items": [self._life_event_row(row) for row in rows]}

    def create_moment(self, args: dict[str, Any]) -> dict[str, Any]:
        self._validate_metadata_only_args(
            args, {"id", "authorId", "visibility", "text", "sourceEventIds", "media", "status", "createdAt"},
            "moment_fields_invalid",
        )
        moment_id = self._validate_work_item_id(args.get("id"), "moment_id")
        author_id = self._validate_work_item_safe_token(args.get("authorId"), "moment_author_id")
        visibility = self._life_visibility(args.get("visibility"))
        text = self._validate_work_item_text(args.get("text"), "moment_text", MOMENT_TEXT_MAX, required=True)
        source_ids = args.get("sourceEventIds")
        if not isinstance(source_ids, list) or not source_ids or len(source_ids) > MOMENT_SOURCE_MAX:
            raise ValueError("moment_source_ids_invalid")
        source_ids = [self._validate_work_item_id(value, "moment_source_id") for value in source_ids]
        if len(set(source_ids)) != len(source_ids):
            raise ValueError("moment_source_ids_duplicate")
        source_json = self._json_list(source_ids, "moment_source_ids", MOMENT_SOURCE_MAX)
        media_json = self._json_list(args.get("media") or [], "moment_media", MOMENT_MEDIA_MAX)
        status = str(args.get("status") or "draft").strip()
        if status not in MOMENT_STATUSES:
            raise ValueError("moment_status_invalid")
        created_at = self._life_timestamp(args.get("createdAt"), "moment_created_at", default_now=True)
        published_at = created_at if status == "published" else ""
        with closing(self.connect()) as database, database:
            existing = database.execute("SELECT * FROM moments WHERE id=?", (moment_id,)).fetchone()
            if existing is not None:
                if existing["deleted_at"]:
                    raise ValueError("moment_tombstoned")
                expected = (author_id, visibility, text, source_json, media_json, status, created_at, published_at)
                actual = tuple(existing[key] for key in (
                    "author_id", "visibility", "text", "source_event_ids_json", "media_json",
                    "status", "created_at", "published_at",
                ))
                if actual != expected:
                    raise ValueError("moment_conflict")
                return {"moment": self._moment_row(existing, []), "replayed": True}
            placeholders = ",".join("?" for _ in source_ids)
            sources = database.execute(
                f"SELECT * FROM life_events WHERE id IN ({placeholders})", source_ids
            ).fetchall()
            if len(sources) != len(source_ids) or any(row["deleted_at"] for row in sources):
                raise ValueError("moment_source_missing")
            visibility_rank = {"private": 0, "shared": 1, "all-characters": 2}
            if any(visibility_rank[visibility] > visibility_rank[row["visibility"]] for row in sources):
                raise ValueError("moment_source_visibility_conflict")
            if any(row["visibility"] == "private" and author_id not in {"user", row["role_id"]} for row in sources):
                raise ValueError("moment_source_visibility_conflict")
            database.execute(
                "INSERT INTO moments VALUES(?,?,?,?,?,?,?,?,?,?)",
                (moment_id, author_id, visibility, text, source_json, media_json, status, created_at, published_at, ""),
            )
            row = database.execute("SELECT * FROM moments WHERE id=?", (moment_id,)).fetchone()
        return {"moment": self._moment_row(row, []), "replayed": False}

    def schedule_moment_comment(self, args: dict[str, Any]) -> dict[str, Any]:
        self._validate_metadata_only_args(
            args, {"id", "momentId", "authorId", "text", "metadata", "dueAt", "createdAt"},
            "moment_comment_fields_invalid",
        )
        comment_id = self._validate_work_item_id(args.get("id"), "moment_comment_id")
        moment_id = self._validate_work_item_id(args.get("momentId"), "moment_id")
        author_id = self._validate_work_item_safe_token(args.get("authorId"), "moment_comment_author_id")
        text = self._validate_work_item_text(args.get("text"), "moment_comment_text", 2000, required=True)
        metadata_json = self._json_object(args.get("metadata") or {}, "moment_comment_metadata", 8192)
        due_at = self._life_timestamp(args.get("dueAt"), "moment_comment_due_at")
        created_at = self._life_timestamp(args.get("createdAt"), "moment_comment_created_at", default_now=True)
        expected = (comment_id, moment_id, author_id, text, metadata_json, due_at, created_at, "", "")
        with closing(self.connect()) as database, database:
            moment = database.execute("SELECT * FROM moments WHERE id=? AND deleted_at=''", (moment_id,)).fetchone()
            if moment is None:
                raise FileNotFoundError("moment_not_found")
            existing = database.execute("SELECT * FROM moment_comments WHERE id=?", (comment_id,)).fetchone()
            if existing is not None:
                semantic = (moment_id, author_id, text, metadata_json)
                actual = tuple(existing[key] for key in ("moment_id", "author_id", "text", "metadata_json"))
                if actual != semantic:
                    raise ValueError("moment_comment_conflict")
                return {"comment": self._moment_comment_row(existing), "replayed": True}
            database.execute("INSERT INTO moment_comments VALUES(?,?,?,?,?,?,?,?,?)", expected)
            row = database.execute("SELECT * FROM moment_comments WHERE id=?", (comment_id,)).fetchone()
        return {"comment": self._moment_comment_row(row), "replayed": False}

    def tick_moments(self, args: dict[str, Any]) -> dict[str, Any]:
        self._validate_metadata_only_args(args, {"now"}, "moment_tick_fields_invalid")
        now = self._life_timestamp(args.get("now"), "moment_tick_now", default_now=True)
        with closing(self.connect()) as database, database:
            rows = database.execute(
                "SELECT id FROM moment_comments WHERE published_at='' AND deleted_at='' AND due_at<=? ORDER BY due_at,id",
                (now,),
            ).fetchall()
            ids = [row["id"] for row in rows]
            if ids:
                placeholders = ",".join("?" for _ in ids)
                database.execute(
                    f"UPDATE moment_comments SET published_at=? WHERE id IN ({placeholders}) AND published_at=''",
                    (now, *ids),
                )
        return {"published": len(ids), "ids": ids, "at": now}

    def list_moments(self, args: dict[str, Any]) -> dict[str, Any]:
        self._validate_metadata_only_args(args, {"visibility", "viewerRoleId", "limit"}, "moment_list_fields_invalid")
        visibility = str(args.get("visibility") or "").strip()
        if visibility and visibility not in LIFE_VISIBILITIES:
            raise ValueError("life_visibility_invalid")
        viewer_role_id = self._validate_work_item_safe_token(
            args.get("viewerRoleId"), "moment_viewer_role_id", required=False
        )
        limit = self._validate_work_item_limit(args.get("limit"), MOMENT_PAGE_MAX)
        clauses = ["deleted_at=''", "status='published'"]
        params: list[Any] = []
        if visibility:
            clauses.append("visibility=?")
            params.append(visibility)
        if viewer_role_id:
            clauses.append("(visibility<>'private' OR author_id=?)")
            params.append(viewer_role_id)
        elif not visibility or visibility == "private":
            clauses.append("visibility<>'private'")
        params.append(limit)
        with closing(self.connect()) as database:
            rows = database.execute(
                f"SELECT * FROM moments WHERE {' AND '.join(clauses)} ORDER BY COALESCE(NULLIF(published_at,''),created_at) DESC,id DESC LIMIT ?",
                tuple(params),
            ).fetchall()
            items = []
            for row in rows:
                comments = database.execute(
                    "SELECT * FROM moment_comments WHERE moment_id=? AND published_at<>'' AND deleted_at='' ORDER BY published_at,id",
                    (row["id"],),
                ).fetchall()
                items.append(self._moment_row(row, comments))
        return {"items": items}

    def tombstone_moment(self, args: dict[str, Any]) -> dict[str, Any]:
        self._validate_metadata_only_args(args, {"id", "deletedAt"}, "moment_tombstone_fields_invalid")
        moment_id = self._validate_work_item_id(args.get("id"), "moment_id")
        deleted_at = self._life_timestamp(args.get("deletedAt"), "moment_deleted_at", default_now=True)
        with closing(self.connect()) as database, database:
            row = database.execute("SELECT deleted_at FROM moments WHERE id=?", (moment_id,)).fetchone()
            if row is None:
                raise FileNotFoundError("moment_not_found")
            if row["deleted_at"]:
                return {"id": moment_id, "deletedAt": row["deleted_at"], "replayed": True}
            database.execute("UPDATE moments SET deleted_at=? WHERE id=?", (deleted_at, moment_id))
            database.execute(
                "UPDATE moment_comments SET deleted_at=? WHERE moment_id=? AND deleted_at=''",
                (deleted_at, moment_id),
            )
        return {"id": moment_id, "deletedAt": deleted_at, "replayed": False}

    @staticmethod
    def _validate_content_reference(value: Any, field: str) -> str:
        reference = str(value or "").strip()
        if len(reference) > 2000:
            raise ValueError(f"{field}_too_large")
        if reference.lower().startswith("data:") or "\x00" in reference:
            raise ValueError(f"{field}_invalid")
        return reference

    @staticmethod
    def _validate_content_hash(value: Any, *, required: bool) -> str:
        content_hash = str(value or "").strip()
        if required and not content_hash:
            raise ValueError("artifact_revision_content_hash_required")
        if content_hash and (
            len(content_hash) > 160
            or not re.fullmatch(r"[A-Za-z0-9._:-]+", content_hash)
        ):
            raise ValueError("work_item_content_hash_invalid")
        return content_hash

    @staticmethod
    def _validate_work_item_json_object(value: Any, field: str) -> tuple[dict[str, Any], str]:
        payload = {} if value is None else value
        if not isinstance(payload, dict):
            raise ValueError(f"{field}_invalid")
        try:
            serialized = json.dumps(
                payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")
            )
            encoded = serialized.encode("utf-8")
        except UnicodeEncodeError as error:
            raise ValueError("work_item_unicode_invalid") from error
        except (TypeError, ValueError) as error:
            raise ValueError(f"{field}_invalid") from error
        if len(encoded) > WORK_ITEM_JSON_MAX_BYTES:
            raise ValueError(f"{field}_too_large")
        return payload, serialized

    @staticmethod
    def _require_work_item(database: sqlite3.Connection, item_id: str) -> sqlite3.Row:
        row = database.execute("SELECT * FROM work_items WHERE id=?", (item_id,)).fetchone()
        if row is None:
            raise FileNotFoundError("work_item_not_found")
        return row

    def _append_work_item_event(
        self,
        database: sqlite3.Connection,
        *,
        item_id: str,
        step_id: str,
        key: str,
        request_hash: str,
        event_type: str,
        actor: str,
        payload: dict[str, Any],
        created_at: str,
    ) -> dict[str, Any]:
        cursor = database.execute(
            """INSERT INTO work_item_events(
                work_item_id,step_id,event_key,request_hash,type,actor,payload_json,created_at
            ) VALUES(?,?,?,?,?,?,?,?)""",
            (
                item_id, step_id, key, request_hash, event_type, actor,
                json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
                created_at,
            ),
        )
        return self._work_item_event_row(
            database.execute(
                "SELECT * FROM work_item_events WHERE id=?", (cursor.lastrowid,)
            ).fetchone()
        )

    def create_work_item(self, args: dict[str, Any]) -> dict[str, Any]:
        key = self._validate_work_item_idempotency_key(args.get("idempotencyKey"))
        workspace_id = self._validate_work_item_id(args.get("workspaceId"), "work_item_workspace_id")
        kind = str(args.get("kind") or "").strip()
        if kind not in WORK_ITEM_KINDS:
            raise ValueError("work_item_kind_invalid")
        title = str(args.get("title") or "").strip()
        if not title:
            raise ValueError("work_item_title_required")
        if len(title) > 160:
            raise ValueError("work_item_title_too_large")
        summary = str(args.get("summary") or "").strip()
        if len(summary) > 4000:
            raise ValueError("work_item_summary_too_large")
        created_by = str(args.get("createdBy") or "").strip()
        if created_by not in WORK_ITEM_CREATORS:
            raise ValueError("work_item_creator_invalid")
        requested_id = str(args.get("id") or "").strip()
        if requested_id:
            requested_id = self._validate_work_item_id(requested_id, "work_item_id")
        character_id = str(args.get("characterId") or "").strip()
        if character_id:
            character_id = self._validate_work_item_id(character_id, "work_item_character_id")
        priority_raw = args.get("priority", 0)
        if isinstance(priority_raw, bool):
            raise ValueError("work_item_priority_invalid")
        try:
            priority = int(priority_raw)
        except (TypeError, ValueError) as error:
            raise ValueError("work_item_priority_invalid") from error
        if priority < -100 or priority > 100:
            raise ValueError("work_item_priority_invalid")

        normalized = {
            "id": requested_id,
            "workspaceId": workspace_id,
            "kind": kind,
            "title": title,
            "summary": summary,
            "createdBy": created_by,
            "characterId": character_id,
            "priority": priority,
        }
        request_hash = self._work_item_request_hash("work_item_create", normalized)
        with closing(self.connect()) as database, database:
            database.execute("BEGIN IMMEDIATE")
            replay = self._work_item_idempotent_result(
                database, key, "work_item_create", request_hash
            )
            if replay is not None:
                return replay
            item_id = requested_id or f"work-{uuid.uuid4().hex}"
            if database.execute("SELECT 1 FROM work_items WHERE id=?", (item_id,)).fetchone():
                raise ValueError("work_item_id_conflict")
            now = utc_now()
            database.execute(
                """INSERT INTO work_items(
                    id,workspace_id,kind,title,summary,status,priority,character_id,
                    active_step_id,created_by,created_at,updated_at,completed_at,archived_at
                ) VALUES(?,?,?,?,?,'draft',?,?, '',?,?,?,'','')""",
                (
                    item_id, workspace_id, kind, title, summary, priority, character_id,
                    created_by, now, now,
                ),
            )
            event_payload = {
                "workspaceId": workspace_id,
                "kind": kind,
                "title": title,
                "status": "draft",
            }
            cursor = database.execute(
                """INSERT INTO work_item_events(
                    work_item_id,step_id,event_key,request_hash,type,actor,payload_json,created_at
                ) VALUES(?,'',?,?,'work_item_created',?,?,?)""",
                (
                    item_id, key, request_hash, created_by,
                    json.dumps(event_payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
                    now,
                ),
            )
            item = self._work_item_row(
                database.execute("SELECT * FROM work_items WHERE id=?", (item_id,)).fetchone()
            )
            event = self._work_item_event_row(
                database.execute("SELECT * FROM work_item_events WHERE id=?", (cursor.lastrowid,)).fetchone()
            )
            result = {"item": item, "event": event, "replayed": False}
            self._record_work_item_idempotency(
                database, key, "work_item_create", request_hash, result
            )
            return result

    def get_work_item(self, args: dict[str, Any]) -> dict[str, Any]:
        item_id = self._validate_work_item_id(args.get("id"), "work_item_id")
        with closing(self.connect()) as database:
            row = database.execute("SELECT * FROM work_items WHERE id=?", (item_id,)).fetchone()
            if row is None:
                raise FileNotFoundError("work_item_not_found")
            counts = {
                "steps": database.execute(
                    "SELECT COUNT(*) FROM work_item_steps WHERE work_item_id=?", (item_id,)
                ).fetchone()[0],
                "sources": database.execute(
                    "SELECT COUNT(*) FROM work_item_sources WHERE work_item_id=?", (item_id,)
                ).fetchone()[0],
                "artifacts": database.execute(
                    "SELECT COUNT(*) FROM work_item_artifacts WHERE work_item_id=?", (item_id,)
                ).fetchone()[0],
                "events": database.execute(
                    "SELECT COUNT(*) FROM work_item_events WHERE work_item_id=?", (item_id,)
                ).fetchone()[0],
            }
            last_event = database.execute(
                "SELECT * FROM work_item_events WHERE work_item_id=? ORDER BY id DESC LIMIT 1",
                (item_id,),
            ).fetchone()
        return {
            "item": self._work_item_row(row),
            "counts": counts,
            "lastEvent": self._work_item_event_row(last_event) if last_event else None,
        }

    def list_work_items(self, args: dict[str, Any]) -> dict[str, Any]:
        limit = self._validate_work_item_limit(args.get("limit"))
        workspace_id = str(args.get("workspaceId") or "").strip()
        if workspace_id:
            workspace_id = self._validate_work_item_id(workspace_id, "work_item_workspace_id")
        kind = str(args.get("kind") or "").strip()
        if kind and kind not in WORK_ITEM_KINDS:
            raise ValueError("work_item_kind_invalid")
        status = str(args.get("status") or "").strip()
        if status and status not in WORK_ITEM_STATUSES:
            raise ValueError("work_item_status_invalid")
        after_created_at = str(args.get("afterCreatedAt") or "").strip()
        after_id = str(args.get("afterId") or "").strip()
        if bool(after_created_at) != bool(after_id):
            raise ValueError("work_item_cursor_incomplete")
        if after_created_at:
            after_created_at = self._validate_work_item_timestamp(after_created_at)
            after_id = self._validate_work_item_id(after_id, "work_item_cursor_id")

        clauses: list[str] = []
        params: list[Any] = []
        if workspace_id:
            clauses.append("workspace_id=?")
            params.append(workspace_id)
        if kind:
            clauses.append("kind=?")
            params.append(kind)
        if status:
            clauses.append("status=?")
            params.append(status)
        if after_created_at:
            clauses.append("(created_at>? OR (created_at=? AND id>?))")
            params.extend((after_created_at, after_created_at, after_id))
        where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
        with closing(self.connect()) as database:
            rows = database.execute(
                f"SELECT * FROM work_items{where} ORDER BY created_at,id LIMIT ?",
                (*params, limit + 1),
            ).fetchall()
        has_more = len(rows) > limit
        page = rows[:limit]
        items = [self._work_item_row(row) for row in page]
        next_cursor = None
        if has_more and items:
            next_cursor = {
                "afterCreatedAt": items[-1]["createdAt"],
                "afterId": items[-1]["id"],
            }
        return {"items": items, "nextCursor": next_cursor}

    def list_work_item_events(self, args: dict[str, Any]) -> dict[str, Any]:
        item_id = self._validate_work_item_id(args.get("id"), "work_item_id")
        limit = self._validate_work_item_limit(args.get("limit"))
        after_raw = args.get("afterId", 0)
        if isinstance(after_raw, bool):
            raise ValueError("work_item_event_cursor_invalid")
        try:
            after_id = int(after_raw)
        except (TypeError, ValueError) as error:
            raise ValueError("work_item_event_cursor_invalid") from error
        if after_id < 0:
            raise ValueError("work_item_event_cursor_invalid")
        with closing(self.connect()) as database:
            if not database.execute("SELECT 1 FROM work_items WHERE id=?", (item_id,)).fetchone():
                raise FileNotFoundError("work_item_not_found")
            rows = database.execute(
                """SELECT * FROM work_item_events
                   WHERE work_item_id=? AND id>? ORDER BY id LIMIT ?""",
                (item_id, after_id, limit + 1),
            ).fetchall()
        has_more = len(rows) > limit
        page = rows[:limit]
        items = [self._work_item_event_row(row) for row in page]
        return {
            "items": items,
            "nextAfterId": items[-1]["id"] if has_more and items else None,
        }

    def transition_work_item(self, args: dict[str, Any]) -> dict[str, Any]:
        item_id = self._validate_work_item_id(args.get("id"), "work_item_id")
        key = self._validate_work_item_idempotency_key(args.get("idempotencyKey"))
        expected_status = str(args.get("expectedStatus") or "").strip()
        target_status = str(args.get("targetStatus") or "").strip()
        if expected_status not in WORK_ITEM_STATUSES:
            raise ValueError("work_item_expected_status_invalid")
        if target_status not in WORK_ITEM_STATUSES:
            raise ValueError("work_item_target_status_invalid")
        actor = str(args.get("actor") or "").strip()
        if actor not in WORK_ITEM_CREATORS:
            raise ValueError("work_item_actor_invalid")
        reason = str(args.get("reason") or "").strip()
        if len(reason) > 1000:
            raise ValueError("work_item_reason_too_large")
        normalized = {
            "id": item_id,
            "expectedStatus": expected_status,
            "targetStatus": target_status,
            "actor": actor,
            "reason": reason,
        }
        request_hash = self._work_item_request_hash("work_item_transition", normalized)

        with closing(self.connect()) as database, database:
            database.execute("BEGIN IMMEDIATE")
            replay = self._work_item_idempotent_result(
                database, key, "work_item_transition", request_hash
            )
            if replay is not None:
                return replay
            row = database.execute("SELECT * FROM work_items WHERE id=?", (item_id,)).fetchone()
            if row is None:
                raise FileNotFoundError("work_item_not_found")
            current_status = row["status"]
            if current_status != expected_status:
                raise ValueError("work_item_status_conflict")
            if target_status not in WORK_ITEM_TRANSITIONS[current_status]:
                raise ValueError("work_item_transition_invalid")
            if target_status in {"completed", "cancelled", "archived"} and database.execute(
                """SELECT 1 FROM work_item_steps
                   WHERE work_item_id=? AND status='active' LIMIT 1""",
                (item_id,),
            ).fetchone():
                raise ValueError("work_item_active_step_conflict")
            reopened = current_status == "completed" and target_status == "active"
            if reopened and not reason:
                raise ValueError("work_item_reopen_reason_required")

            now = utc_now()
            completed_at = row["completed_at"]
            archived_at = row["archived_at"]
            if target_status == "completed":
                completed_at = now
            elif reopened:
                completed_at = ""
            if target_status == "archived":
                archived_at = now
            database.execute(
                """UPDATE work_items
                   SET status=?,updated_at=?,completed_at=?,archived_at=? WHERE id=?""",
                (target_status, now, completed_at, archived_at, item_id),
            )
            event_type = "work_item_reopened" if reopened else "work_item_transitioned"
            event_payload = {
                "fromStatus": current_status,
                "toStatus": target_status,
                "reason": reason,
            }
            cursor = database.execute(
                """INSERT INTO work_item_events(
                    work_item_id,step_id,event_key,request_hash,type,actor,payload_json,created_at
                ) VALUES(?,'',?,?,?,?,?,?)""",
                (
                    item_id, key, request_hash, event_type, actor,
                    json.dumps(event_payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
                    now,
                ),
            )
            item = self._work_item_row(
                database.execute("SELECT * FROM work_items WHERE id=?", (item_id,)).fetchone()
            )
            event = self._work_item_event_row(
                database.execute("SELECT * FROM work_item_events WHERE id=?", (cursor.lastrowid,)).fetchone()
            )
            result = {"item": item, "event": event, "replayed": False}
            self._record_work_item_idempotency(
                database, key, "work_item_transition", request_hash, result
            )
            return result

    def create_work_item_step(self, args: dict[str, Any]) -> dict[str, Any]:
        key = self._validate_work_item_idempotency_key(args.get("idempotencyKey"))
        item_id = self._validate_work_item_id(args.get("workItemId"), "work_item_id")
        requested_id = str(args.get("id") or "").strip()
        if requested_id:
            requested_id = self._validate_work_item_id(requested_id, "work_item_step_id")
        ordinal_raw = args.get("ordinal")
        if isinstance(ordinal_raw, bool):
            raise ValueError("work_item_step_ordinal_invalid")
        try:
            ordinal = int(ordinal_raw)
        except (TypeError, ValueError) as error:
            raise ValueError("work_item_step_ordinal_invalid") from error
        if ordinal < 1 or ordinal > 1_000_000:
            raise ValueError("work_item_step_ordinal_invalid")
        kind = str(args.get("kind") or "").strip()
        if kind not in WORK_ITEM_STEP_KINDS:
            raise ValueError("work_item_step_kind_invalid")
        title = self._validate_work_item_text(
            args.get("title"), "work_item_step_title", 160, required=True
        )
        owner = self._validate_work_item_id(args.get("owner"), "work_item_step_owner")
        task_id = str(args.get("taskId") or "").strip()
        if task_id:
            task_id = self._validate_work_item_id(task_id, "work_item_step_task_id")
        agent_run_id = str(args.get("agentRunId") or "").strip()
        if agent_run_id:
            agent_run_id = self._validate_work_item_id(
                agent_run_id, "work_item_step_agent_run_id"
            )
        input_payload, input_json = self._validate_work_item_json_object(
            args.get("input"), "work_item_step_input"
        )
        normalized = {
            "id": requested_id, "workItemId": item_id, "ordinal": ordinal,
            "kind": kind, "title": title, "owner": owner, "taskId": task_id,
            "agentRunId": agent_run_id, "input": input_payload,
        }
        operation = "work_item_step_create"
        request_hash = self._work_item_request_hash(operation, normalized)
        with closing(self.connect()) as database, database:
            database.execute("BEGIN IMMEDIATE")
            replay = self._work_item_idempotent_result(database, key, operation, request_hash)
            if replay is not None:
                return replay
            item_row = self._require_work_item(database, item_id)
            if item_row["status"] in WORK_ITEM_TERMINAL_STATUSES:
                raise ValueError("work_item_terminal_state_conflict")
            for field, reference in (("task", task_id), ("agent_run", agent_run_id)):
                if reference and not database.execute(
                    "SELECT 1 FROM tasks WHERE id=?", (reference,)
                ).fetchone():
                    raise FileNotFoundError(f"work_item_step_{field}_not_found")
            step_id = requested_id or f"step-{uuid.uuid4().hex}"
            if database.execute("SELECT 1 FROM work_item_steps WHERE id=?", (step_id,)).fetchone():
                raise ValueError("work_item_step_id_conflict")
            if database.execute(
                "SELECT 1 FROM work_item_steps WHERE work_item_id=? AND ordinal=?",
                (item_id, ordinal),
            ).fetchone():
                raise ValueError("work_item_step_ordinal_conflict")
            now = utc_now()
            database.execute(
                """INSERT INTO work_item_steps(
                    id,work_item_id,ordinal,kind,title,status,owner,task_id,agent_run_id,
                    input_json,result_summary,created_at,updated_at
                ) VALUES(?,?,?,?,?,'pending',?,?,?,?, '',?,?)""",
                (
                    step_id, item_id, ordinal, kind, title, owner, task_id, agent_run_id,
                    input_json, now, now,
                ),
            )
            database.execute("UPDATE work_items SET updated_at=? WHERE id=?", (now, item_id))
            step = self._work_item_step_row(
                database.execute("SELECT * FROM work_item_steps WHERE id=?", (step_id,)).fetchone()
            )
            event = self._append_work_item_event(
                database, item_id=item_id, step_id=step_id, key=key,
                request_hash=request_hash, event_type="work_item_step_created", actor=owner,
                payload={"ordinal": ordinal, "kind": kind, "title": title, "status": "pending"},
                created_at=now,
            )
            result = {"step": step, "event": event, "replayed": False}
            self._record_work_item_idempotency(database, key, operation, request_hash, result)
            return result

    def transition_work_item_step(self, args: dict[str, Any]) -> dict[str, Any]:
        key = self._validate_work_item_idempotency_key(args.get("idempotencyKey"))
        item_id = self._validate_work_item_id(args.get("workItemId"), "work_item_id")
        step_id = self._validate_work_item_id(args.get("stepId"), "work_item_step_id")
        expected_status = str(args.get("expectedStatus") or "").strip()
        target_status = str(args.get("targetStatus") or "").strip()
        if expected_status not in WORK_ITEM_STEP_STATUSES:
            raise ValueError("work_item_step_expected_status_invalid")
        if target_status not in WORK_ITEM_STEP_STATUSES:
            raise ValueError("work_item_step_target_status_invalid")
        actor = str(args.get("actor") or "").strip()
        if actor not in WORK_ITEM_CREATORS:
            raise ValueError("work_item_step_actor_invalid")
        result_summary = self._validate_work_item_text(
            args.get("resultSummary"), "work_item_step_result_summary", 4000
        )
        normalized = {
            "workItemId": item_id, "stepId": step_id,
            "expectedStatus": expected_status, "targetStatus": target_status,
            "actor": actor, "resultSummary": result_summary,
        }
        operation = "work_item_step_transition"
        request_hash = self._work_item_request_hash(operation, normalized)
        with closing(self.connect()) as database, database:
            database.execute("BEGIN IMMEDIATE")
            replay = self._work_item_idempotent_result(database, key, operation, request_hash)
            if replay is not None:
                return replay
            item_row = self._require_work_item(database, item_id)
            step_row = database.execute(
                "SELECT * FROM work_item_steps WHERE id=? AND work_item_id=?",
                (step_id, item_id),
            ).fetchone()
            if step_row is None:
                if database.execute("SELECT 1 FROM work_item_steps WHERE id=?", (step_id,)).fetchone():
                    raise PermissionError("work_item_step_cross_item")
                raise FileNotFoundError("work_item_step_not_found")
            if (
                target_status == "active"
                and item_row["status"] in WORK_ITEM_TERMINAL_STATUSES
            ):
                raise ValueError("work_item_terminal_state_conflict")
            current_status = step_row["status"]
            if current_status != expected_status:
                raise ValueError("work_item_step_status_conflict")
            if target_status not in WORK_ITEM_STEP_TRANSITIONS[current_status]:
                raise ValueError("work_item_step_transition_invalid")
            if target_status == "active" and database.execute(
                """SELECT 1 FROM work_item_steps
                   WHERE work_item_id=? AND status='active' AND id<>? LIMIT 1""",
                (item_id, step_id),
            ).fetchone():
                raise ValueError("work_item_active_step_conflict")
            now = utc_now()
            database.execute(
                "UPDATE work_item_steps SET status=?,result_summary=?,updated_at=? WHERE id=?",
                (target_status, result_summary, now, step_id),
            )
            active_step_id = item_row["active_step_id"]
            if target_status == "active":
                active_step_id = step_id
            elif active_step_id == step_id:
                active_step_id = ""
            database.execute(
                "UPDATE work_items SET active_step_id=?,updated_at=? WHERE id=?",
                (active_step_id, now, item_id),
            )
            step = self._work_item_step_row(
                database.execute("SELECT * FROM work_item_steps WHERE id=?", (step_id,)).fetchone()
            )
            item = self._work_item_row(
                database.execute("SELECT * FROM work_items WHERE id=?", (item_id,)).fetchone()
            )
            event = self._append_work_item_event(
                database, item_id=item_id, step_id=step_id, key=key,
                request_hash=request_hash, event_type="work_item_step_transitioned", actor=actor,
                payload={
                    "fromStatus": current_status, "toStatus": target_status,
                    "resultSummary": result_summary,
                },
                created_at=now,
            )
            result = {
                "step": step, "workItem": item, "event": event, "replayed": False,
            }
            self._record_work_item_idempotency(database, key, operation, request_hash, result)
            return result

    def attach_work_item_source(self, args: dict[str, Any]) -> dict[str, Any]:
        self._validate_metadata_only_args(
            args,
            {
                "id", "workItemId", "idempotencyKey", "kind", "title", "origin",
                "contentRef", "contentHash", "provenance", "sensitivity", "status",
            },
            "work_item_source_metadata_only",
        )
        key = self._validate_work_item_idempotency_key(args.get("idempotencyKey"))
        item_id = self._validate_work_item_id(args.get("workItemId"), "work_item_id")
        requested_id = str(args.get("id") or "").strip()
        if requested_id:
            requested_id = self._validate_work_item_id(requested_id, "work_item_source_id")
        kind = str(args.get("kind") or "").strip()
        if kind not in WORK_ITEM_SOURCE_KINDS:
            raise ValueError("work_item_source_kind_invalid")
        title = self._validate_work_item_text(
            args.get("title"), "work_item_source_title", 160, required=True
        )
        origin = self._validate_content_reference(
            args.get("origin"), "work_item_source_origin"
        )
        content_ref = self._validate_content_reference(
            args.get("contentRef"), "work_item_source_content_ref"
        )
        content_hash = self._validate_content_hash(args.get("contentHash"), required=False)
        provenance = str(args.get("provenance") or "").strip()
        if provenance not in WORK_ITEM_SOURCE_PROVENANCE:
            raise ValueError("work_item_source_provenance_invalid")
        sensitivity = str(args.get("sensitivity") or "").strip()
        if sensitivity not in WORK_ITEM_SOURCE_SENSITIVITY:
            raise ValueError("work_item_source_sensitivity_invalid")
        status = str(args.get("status") or "").strip()
        if status not in WORK_ITEM_SOURCE_STATUSES:
            raise ValueError("work_item_source_status_invalid")
        normalized = {
            "id": requested_id, "workItemId": item_id, "kind": kind, "title": title,
            "origin": origin, "contentRef": content_ref, "contentHash": content_hash,
            "provenance": provenance, "sensitivity": sensitivity, "status": status,
        }
        operation = "work_item_source_attach"
        request_hash = self._work_item_request_hash(operation, normalized)
        with closing(self.connect()) as database, database:
            database.execute("BEGIN IMMEDIATE")
            replay = self._work_item_idempotent_result(database, key, operation, request_hash)
            if replay is not None:
                return replay
            self._require_work_item(database, item_id)
            source_id = requested_id or f"source-{uuid.uuid4().hex}"
            if database.execute("SELECT 1 FROM work_item_sources WHERE id=?", (source_id,)).fetchone():
                raise ValueError("work_item_source_id_conflict")
            now = utc_now()
            database.execute(
                """INSERT INTO work_item_sources(
                    id,work_item_id,kind,title,origin,content_ref,content_hash,
                    provenance,sensitivity,status,created_at,updated_at
                ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    source_id, item_id, kind, title, origin, content_ref, content_hash,
                    provenance, sensitivity, status, now, now,
                ),
            )
            database.execute("UPDATE work_items SET updated_at=? WHERE id=?", (now, item_id))
            source = self._work_item_source_row(
                database.execute("SELECT * FROM work_item_sources WHERE id=?", (source_id,)).fetchone()
            )
            event = self._append_work_item_event(
                database, item_id=item_id, step_id="", key=key,
                request_hash=request_hash, event_type="work_item_source_attached", actor="user",
                payload={
                    "sourceId": source_id, "kind": kind, "title": title,
                    "provenance": provenance, "sensitivity": sensitivity, "status": status,
                },
                created_at=now,
            )
            result = {"source": source, "event": event, "replayed": False}
            self._record_work_item_idempotency(database, key, operation, request_hash, result)
            return result

    def list_work_item_sources(self, args: dict[str, Any]) -> dict[str, Any]:
        item_id = self._validate_work_item_id(args.get("workItemId"), "work_item_id")
        limit = self._validate_work_item_limit(args.get("limit"))
        after_created_at = str(args.get("afterCreatedAt") or "").strip()
        after_id = str(args.get("afterId") or "").strip()
        if bool(after_created_at) != bool(after_id):
            raise ValueError("work_item_cursor_incomplete")
        if after_created_at:
            after_created_at = self._validate_work_item_timestamp(after_created_at)
            after_id = self._validate_work_item_id(after_id, "work_item_cursor_id")
        with closing(self.connect()) as database:
            self._require_work_item(database, item_id)
            params: list[Any] = [item_id]
            cursor_clause = ""
            if after_created_at:
                cursor_clause = " AND (created_at>? OR (created_at=? AND id>?))"
                params.extend((after_created_at, after_created_at, after_id))
            rows = database.execute(
                f"""SELECT * FROM work_item_sources
                    WHERE work_item_id=?{cursor_clause}
                    ORDER BY created_at,id LIMIT ?""",
                (*params, limit + 1),
            ).fetchall()
        has_more = len(rows) > limit
        page = rows[:limit]
        items = [self._work_item_source_row(row) for row in page]
        next_cursor = None
        if has_more and items:
            next_cursor = {
                "afterCreatedAt": items[-1]["createdAt"], "afterId": items[-1]["id"],
            }
        return {"items": items, "nextCursor": next_cursor}

    def create_work_item_artifact(self, args: dict[str, Any]) -> dict[str, Any]:
        key = self._validate_work_item_idempotency_key(args.get("idempotencyKey"))
        item_id = self._validate_work_item_id(args.get("workItemId"), "work_item_id")
        requested_id = str(args.get("id") or "").strip()
        if requested_id:
            requested_id = self._validate_work_item_id(requested_id, "work_item_artifact_id")
        kind = str(args.get("kind") or "").strip()
        if kind not in WORK_ITEM_ARTIFACT_KINDS:
            raise ValueError("work_item_artifact_kind_invalid")
        title = self._validate_work_item_text(
            args.get("title"), "work_item_artifact_title", 160, required=True
        )
        status = str(args.get("status") or "draft").strip()
        if status not in WORK_ITEM_ARTIFACT_STATUSES:
            raise ValueError("work_item_artifact_status_invalid")
        if status == "published":
            raise ValueError("work_item_artifact_published_requires_revision")
        normalized = {
            "id": requested_id, "workItemId": item_id, "kind": kind,
            "title": title, "status": status,
        }
        operation = "work_item_artifact_create"
        request_hash = self._work_item_request_hash(operation, normalized)
        with closing(self.connect()) as database, database:
            database.execute("BEGIN IMMEDIATE")
            replay = self._work_item_idempotent_result(database, key, operation, request_hash)
            if replay is not None:
                return replay
            self._require_work_item(database, item_id)
            artifact_id = requested_id or f"artifact-{uuid.uuid4().hex}"
            if database.execute(
                "SELECT 1 FROM work_item_artifacts WHERE id=?", (artifact_id,)
            ).fetchone():
                raise ValueError("work_item_artifact_id_conflict")
            now = utc_now()
            database.execute(
                """INSERT INTO work_item_artifacts(
                    id,work_item_id,kind,title,status,current_revision_id,created_at,updated_at
                ) VALUES(?,?,?,?,?,'',?,?)""",
                (artifact_id, item_id, kind, title, status, now, now),
            )
            database.execute("UPDATE work_items SET updated_at=? WHERE id=?", (now, item_id))
            artifact = self._work_item_artifact_row(
                database.execute(
                    "SELECT * FROM work_item_artifacts WHERE id=?", (artifact_id,)
                ).fetchone()
            )
            event = self._append_work_item_event(
                database, item_id=item_id, step_id="", key=key,
                request_hash=request_hash, event_type="work_item_artifact_created", actor="user",
                payload={
                    "artifactId": artifact_id, "kind": kind, "title": title, "status": status,
                },
                created_at=now,
            )
            result = {"artifact": artifact, "event": event, "replayed": False}
            self._record_work_item_idempotency(database, key, operation, request_hash, result)
            return result

    def create_artifact_revision(self, args: dict[str, Any]) -> dict[str, Any]:
        self._validate_metadata_only_args(
            args,
            {
                "id", "workItemId", "artifactId", "idempotencyKey",
                "parentRevisionId", "format", "contentRef", "contentHash",
                "contentJson", "author", "validationStatus", "sourceIds", "published",
            },
            "artifact_revision_metadata_only",
        )
        key = self._validate_work_item_idempotency_key(args.get("idempotencyKey"))
        item_id = self._validate_work_item_id(args.get("workItemId"), "work_item_id")
        artifact_id = self._validate_work_item_id(
            args.get("artifactId"), "work_item_artifact_id"
        )
        requested_id = str(args.get("id") or "").strip()
        if requested_id:
            requested_id = self._validate_work_item_id(
                requested_id, "artifact_revision_id"
            )
        parent_revision_id = str(args.get("parentRevisionId") or "").strip()
        if parent_revision_id:
            parent_revision_id = self._validate_work_item_id(
                parent_revision_id, "artifact_parent_revision_id"
            )
        revision_format = self._validate_work_item_safe_token(
            args.get("format"), "artifact_revision_format"
        )
        content_ref = self._validate_content_reference(
            args.get("contentRef"), "artifact_revision_content_ref"
        )
        content_hash = self._validate_content_hash(args.get("contentHash"), required=True)
        content_json_provided = "contentJson" in args
        content_json = ""
        if content_json_provided:
            content_json_value = args.get("contentJson")
            if not isinstance(content_json_value, str):
                raise ValueError("artifact_revision_content_json_invalid")
            content_json = content_json_value
            try:
                content_json_bytes = content_json.encode("utf-8")
            except UnicodeEncodeError as error:
                raise ValueError("work_item_unicode_invalid") from error
            if len(content_json_bytes) > WORK_ITEM_JSON_MAX_BYTES:
                raise ValueError("artifact_revision_content_json_too_large")
            try:
                json.loads(content_json)
            except json.JSONDecodeError as error:
                raise ValueError("artifact_revision_content_json_invalid") from error
            if revision_format != "json":
                raise ValueError("artifact_revision_content_format_invalid")
            if not requested_id:
                raise ValueError("artifact_revision_content_id_required")
            expected_ref = f"runtime:artifact_revision_content:{requested_id}"
            if content_ref != expected_ref:
                raise ValueError("artifact_revision_content_ref_invalid")
            if content_hash != hashlib.sha256(content_json_bytes).hexdigest():
                raise ValueError("artifact_revision_content_hash_mismatch")
        author = str(args.get("author") or "").strip()
        if author not in WORK_ITEM_CREATORS:
            raise ValueError("artifact_revision_author_invalid")
        validation_status = str(args.get("validationStatus") or "").strip()
        if validation_status not in ARTIFACT_REVISION_VALIDATION_STATUSES:
            raise ValueError("artifact_revision_validation_status_invalid")
        source_ids_raw = args.get("sourceIds", [])
        if not isinstance(source_ids_raw, list) or len(source_ids_raw) > WORK_ITEM_SOURCE_IDS_MAX:
            raise ValueError("artifact_revision_source_ids_invalid")
        source_ids = [
            self._validate_work_item_id(value, "artifact_revision_source_id")
            for value in source_ids_raw
        ]
        if len(source_ids) != len(set(source_ids)):
            raise ValueError("artifact_revision_source_ids_duplicate")
        published = args.get("published", False)
        if not isinstance(published, bool):
            raise ValueError("artifact_revision_published_invalid")
        if published and validation_status not in {"valid", "approved"}:
            raise ValueError("artifact_revision_publish_requires_valid")
        normalized = {
            "id": requested_id, "workItemId": item_id, "artifactId": artifact_id,
            "parentRevisionId": parent_revision_id, "format": revision_format,
            "contentRef": content_ref, "contentHash": content_hash, "author": author,
            "validationStatus": validation_status, "sourceIds": source_ids,
            "published": published,
        }
        if content_json_provided:
            normalized["contentJson"] = content_json
        operation = "artifact_revision_create"
        request_hash = self._work_item_request_hash(operation, normalized)
        with closing(self.connect()) as database, database:
            database.execute("BEGIN IMMEDIATE")
            replay = self._work_item_idempotent_result(database, key, operation, request_hash)
            if replay is not None:
                return replay
            self._require_work_item(database, item_id)
            artifact_row = database.execute(
                "SELECT * FROM work_item_artifacts WHERE id=? AND work_item_id=?",
                (artifact_id, item_id),
            ).fetchone()
            if artifact_row is None:
                if database.execute(
                    "SELECT 1 FROM work_item_artifacts WHERE id=?", (artifact_id,)
                ).fetchone():
                    raise PermissionError("work_item_artifact_cross_item")
                raise FileNotFoundError("work_item_artifact_not_found")
            if artifact_row["status"] == "archived":
                raise ValueError("work_item_artifact_archived")
            current_revision_id = artifact_row["current_revision_id"]
            if parent_revision_id != current_revision_id:
                raise ValueError("artifact_revision_parent_conflict")
            if current_revision_id:
                current_revision = database.execute(
                    "SELECT 1 FROM artifact_revisions WHERE id=? AND artifact_id=?",
                    (current_revision_id, artifact_id),
                ).fetchone()
                if current_revision is None:
                    raise ValueError("artifact_revision_chain_corrupt")
            if database.execute(
                """SELECT 1 FROM artifact_revisions
                   WHERE artifact_id=? AND content_hash=?""",
                (artifact_id, content_hash),
            ).fetchone():
                raise ValueError("artifact_revision_hash_conflict")
            revision_id = requested_id or f"revision-{uuid.uuid4().hex}"
            if database.execute(
                "SELECT 1 FROM artifact_revisions WHERE id=?", (revision_id,)
            ).fetchone():
                raise ValueError("artifact_revision_id_conflict")
            if source_ids:
                placeholders = ",".join("?" for _ in source_ids)
                rows = database.execute(
                    f"""SELECT id FROM work_item_sources
                        WHERE work_item_id=? AND id IN ({placeholders})""",
                    (item_id, *source_ids),
                ).fetchall()
                if {row["id"] for row in rows} != set(source_ids):
                    raise PermissionError("artifact_revision_source_cross_item")
            now = utc_now()
            source_ids_json = json.dumps(
                source_ids, ensure_ascii=False, separators=(",", ":")
            )
            if len(source_ids_json.encode("utf-8")) > WORK_ITEM_JSON_MAX_BYTES:
                raise ValueError("artifact_revision_source_ids_too_large")
            database.execute(
                """INSERT INTO artifact_revisions(
                    id,artifact_id,parent_revision_id,format,content_ref,content_hash,
                    content_json,author,validation_status,source_ids_json,published,created_at
                ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    revision_id, artifact_id, parent_revision_id, revision_format,
                    content_ref, content_hash, content_json, author, validation_status,
                    source_ids_json, int(published), now,
                ),
            )
            if published:
                artifact_status = "published"
            elif artifact_row["status"] == "published":
                artifact_status = "draft"
            else:
                artifact_status = artifact_row["status"]
            database.execute(
                """UPDATE work_item_artifacts
                   SET current_revision_id=?,status=?,updated_at=? WHERE id=?""",
                (revision_id, artifact_status, now, artifact_id),
            )
            database.execute("UPDATE work_items SET updated_at=? WHERE id=?", (now, item_id))
            revision_row = database.execute(
                "SELECT * FROM artifact_revisions WHERE id=?", (revision_id,)
            ).fetchone()
            artifact_row = database.execute(
                "SELECT * FROM work_item_artifacts WHERE id=?", (artifact_id,)
            ).fetchone()
            revision = self._artifact_revision_row(revision_row)
            artifact = self._work_item_artifact_row(artifact_row, revision_row)
            event = self._append_work_item_event(
                database, item_id=item_id, step_id="", key=key,
                request_hash=request_hash, event_type="artifact_revision_created", actor=author,
                payload={
                    "artifactId": artifact_id, "revisionId": revision_id,
                    "parentRevisionId": parent_revision_id, "contentHash": content_hash,
                    "validationStatus": validation_status, "sourceIds": source_ids,
                    "published": published,
                },
                created_at=now,
            )
            result = {
                "artifact": artifact, "revision": revision,
                "event": event, "replayed": False,
            }
            self._record_work_item_idempotency(database, key, operation, request_hash, result)
            return result

    def get_artifact_revision_content(self, args: dict[str, Any]) -> dict[str, Any]:
        self._validate_metadata_only_args(
            args, {"workItemId", "revisionId"}, "artifact_revision_content_get_metadata_only"
        )
        item_id = self._validate_work_item_id(args.get("workItemId"), "work_item_id")
        revision_id = self._validate_work_item_id(
            args.get("revisionId"), "artifact_revision_id"
        )
        with closing(self.connect()) as database:
            self._require_work_item(database, item_id)
            row = database.execute(
                """SELECT r.content_json,r.content_hash,r.content_ref
                   FROM artifact_revisions r
                   JOIN work_item_artifacts a ON a.id=r.artifact_id
                   WHERE r.id=? AND a.work_item_id=?""",
                (revision_id, item_id),
            ).fetchone()
            if row is None:
                if database.execute(
                    "SELECT 1 FROM artifact_revisions WHERE id=?", (revision_id,)
                ).fetchone():
                    raise PermissionError("artifact_revision_content_cross_item")
                raise FileNotFoundError("artifact_revision_content_not_found")
        return {
            "available": bool(row["content_json"]),
            "contentJson": row["content_json"],
            "contentHash": row["content_hash"],
            "contentRef": row["content_ref"],
        }

    def list_work_item_artifacts(self, args: dict[str, Any]) -> dict[str, Any]:
        item_id = self._validate_work_item_id(args.get("workItemId"), "work_item_id")
        limit = self._validate_work_item_limit(args.get("limit"))
        after_created_at = str(args.get("afterCreatedAt") or "").strip()
        after_id = str(args.get("afterId") or "").strip()
        if bool(after_created_at) != bool(after_id):
            raise ValueError("work_item_cursor_incomplete")
        if after_created_at:
            after_created_at = self._validate_work_item_timestamp(after_created_at)
            after_id = self._validate_work_item_id(after_id, "work_item_cursor_id")
        with closing(self.connect()) as database:
            self._require_work_item(database, item_id)
            params: list[Any] = [item_id]
            cursor_clause = ""
            if after_created_at:
                cursor_clause = " AND (a.created_at>? OR (a.created_at=? AND a.id>?))"
                params.extend((after_created_at, after_created_at, after_id))
            rows = database.execute(
                f"""SELECT a.*,r.id AS revision_join_id,r.artifact_id AS revision_artifact_id,
                           r.parent_revision_id AS revision_parent_revision_id,
                           r.format AS revision_format,r.content_ref AS revision_content_ref,
                           r.content_hash AS revision_content_hash,r.author AS revision_author,
                           r.validation_status AS revision_validation_status,
                           r.source_ids_json AS revision_source_ids_json,
                           r.published AS revision_published,r.created_at AS revision_created_at
                    FROM work_item_artifacts a
                    LEFT JOIN artifact_revisions r ON r.id=a.current_revision_id
                    WHERE a.work_item_id=?{cursor_clause}
                    ORDER BY a.created_at,a.id LIMIT ?""",
                (*params, limit + 1),
            ).fetchall()
        has_more = len(rows) > limit
        page = rows[:limit]
        items = []
        for row in page:
            current_revision = None
            if row["revision_join_id"]:
                current_revision = {
                    "id": row["revision_join_id"],
                    "artifact_id": row["revision_artifact_id"],
                    "parent_revision_id": row["revision_parent_revision_id"],
                    "format": row["revision_format"],
                    "content_ref": row["revision_content_ref"],
                    "content_hash": row["revision_content_hash"],
                    "author": row["revision_author"],
                    "validation_status": row["revision_validation_status"],
                    "source_ids_json": row["revision_source_ids_json"],
                    "published": row["revision_published"],
                    "created_at": row["revision_created_at"],
                }
            items.append(self._work_item_artifact_row(row, current_revision))
        next_cursor = None
        if has_more and items:
            next_cursor = {
                "afterCreatedAt": items[-1]["createdAt"], "afterId": items[-1]["id"],
            }
        return {"items": items, "nextCursor": next_cursor}

    def link_work_item_schedule(self, args: dict[str, Any]) -> dict[str, Any]:
        self._validate_metadata_only_args(
            args,
            {"workItemId", "scheduleId", "relation", "idempotencyKey"},
            "work_item_schedule_link_metadata_only",
        )
        key = self._validate_work_item_idempotency_key(args.get("idempotencyKey"))
        item_id = self._validate_work_item_id(args.get("workItemId"), "work_item_id")
        schedule_id = self._validate_work_item_id(
            args.get("scheduleId"), "work_item_schedule_id"
        )
        relation = self._validate_work_item_safe_token(
            args.get("relation"), "work_item_schedule_relation"
        )
        normalized = {
            "workItemId": item_id, "scheduleId": schedule_id, "relation": relation,
        }
        operation = "work_item_schedule_link"
        request_hash = self._work_item_request_hash(operation, normalized)
        with closing(self.connect()) as database, database:
            database.execute("BEGIN IMMEDIATE")
            replay = self._work_item_idempotent_result(database, key, operation, request_hash)
            if replay is not None:
                return replay
            self._require_work_item(database, item_id)
            if not database.execute(
                "SELECT 1 FROM schedules WHERE id=?", (schedule_id,)
            ).fetchone():
                raise FileNotFoundError("work_item_schedule_not_found")
            if database.execute(
                """SELECT 1 FROM work_item_schedule_links
                   WHERE work_item_id=? AND schedule_id=? AND relation=?""",
                (item_id, schedule_id, relation),
            ).fetchone():
                raise ValueError("work_item_schedule_link_exists")
            now = utc_now()
            database.execute(
                "INSERT INTO work_item_schedule_links VALUES(?,?,?,?)",
                (item_id, schedule_id, relation, now),
            )
            database.execute("UPDATE work_items SET updated_at=? WHERE id=?", (now, item_id))
            link = {
                "workItemId": item_id, "scheduleId": schedule_id,
                "relation": relation, "createdAt": now,
            }
            event = self._append_work_item_event(
                database, item_id=item_id, step_id="", key=key,
                request_hash=request_hash, event_type="work_item_schedule_linked", actor="user",
                payload={
                    "scheduleId": schedule_id, "relation": relation,
                },
                created_at=now,
            )
            result = {"link": link, "event": event, "replayed": False}
            self._record_work_item_idempotency(database, key, operation, request_hash, result)
            return result

    def link_work_item_conversation(self, args: dict[str, Any]) -> dict[str, Any]:
        self._validate_metadata_only_args(
            args,
            {
                "workItemId", "sessionId", "roleId", "mode", "relation",
                "idempotencyKey",
            },
            "work_item_conversation_link_metadata_only",
        )
        key = self._validate_work_item_idempotency_key(args.get("idempotencyKey"))
        item_id = self._validate_work_item_id(args.get("workItemId"), "work_item_id")
        session_id = self._validate_work_item_id(
            args.get("sessionId"), "work_item_conversation_session_id"
        )
        role_id = self._validate_work_item_id(
            args.get("roleId"), "work_item_conversation_role_id"
        )
        mode = str(args.get("mode") or "").strip()
        if mode not in WORK_ITEM_CONVERSATION_MODES:
            raise ValueError("work_item_conversation_mode_invalid")
        relation = self._validate_work_item_safe_token(
            args.get("relation"), "work_item_conversation_relation"
        )
        normalized = {
            "workItemId": item_id, "sessionId": session_id, "roleId": role_id,
            "mode": mode, "relation": relation,
        }
        operation = "work_item_conversation_link"
        request_hash = self._work_item_request_hash(operation, normalized)
        with closing(self.connect()) as database, database:
            database.execute("BEGIN IMMEDIATE")
            replay = self._work_item_idempotent_result(database, key, operation, request_hash)
            if replay is not None:
                return replay
            self._require_work_item(database, item_id)
            if database.execute(
                """SELECT 1 FROM work_item_conversation_links
                   WHERE work_item_id=? AND session_id=? AND role_id=? AND mode=? AND relation=?""",
                (item_id, session_id, role_id, mode, relation),
            ).fetchone():
                raise ValueError("work_item_conversation_link_exists")
            now = utc_now()
            database.execute(
                "INSERT INTO work_item_conversation_links VALUES(?,?,?,?,?,?)",
                (item_id, session_id, role_id, mode, relation, now),
            )
            database.execute("UPDATE work_items SET updated_at=? WHERE id=?", (now, item_id))
            link = {
                "workItemId": item_id, "sessionId": session_id, "roleId": role_id,
                "mode": mode, "relation": relation, "createdAt": now,
            }
            event = self._append_work_item_event(
                database, item_id=item_id, step_id="", key=key,
                request_hash=request_hash, event_type="work_item_conversation_linked", actor="user",
                payload={
                    "sessionId": session_id, "roleId": role_id,
                    "mode": mode, "relation": relation,
                },
                created_at=now,
            )
            result = {"link": link, "event": event, "replayed": False}
            self._record_work_item_idempotency(database, key, operation, request_hash, result)
            return result

    def propose_action(self, payload: dict[str, Any]) -> dict[str, Any]:
        action_type = str(payload.get("actionType") or "")
        if action_type == "mcp_tool_call":
            raise PermissionError("mcp_use_scoped_proposal_endpoint")
        if action_type.startswith("office_create_"):
            self._require_extension("office-core")
        proposal = self.approvals.propose(payload)
        self._emit_event("action_proposed", proposal["role_id"], {
            "proposalId": proposal["id"], "actionType": proposal["action_type"],
            "riskLevel": proposal["risk_level"], "summary": proposal["summary"],
            "sessionId": proposal["session_id"], "taskId": proposal["task_id"],
        })
        return proposal

    def propose_mcp_tool(self, payload):
        role_id = str(payload.get("roleId") or "")
        snapshot = self.remote_mcp.snapshot(str(payload.get("serverId") or ""),
            str(payload.get("toolName") or ""), payload.get("arguments"), role_id)
        proposal = self.approvals.propose({"actionType": "mcp_tool_call", "args": snapshot, "roleId": role_id,
            "sessionId": str(payload.get("sessionId") or "mcp-settings"), "taskId": str(payload.get("taskId") or ""),
            "toolCallId": str(payload.get("toolCallId") or ""),
            "summary": str(payload.get("summary") or "调用远程工具 · " + snapshot["toolName"]),
            "reason": str(payload.get("reason") or "仅发送已展示的参数给该远程服务器，等待你的确认。")})
        self._emit_event("action_proposed", role_id, {"proposalId": proposal["id"], "actionType": "mcp_tool_call",
            "riskLevel": "R3", "summary": proposal["summary"], "sessionId": proposal["session_id"], "taskId": proposal["task_id"]})
        return proposal

    def resolve_action_proposal(
        self,
        proposal_id: str,
        decision: str,
        executor: Callable[[str, dict[str, Any]], dict[str, Any]],
    ) -> dict[str, Any]:
        result = self.approvals.resolve(proposal_id, decision, executor)
        proposal = result.get("proposal") or {}
        self._emit_event("action_proposal_resolved", str(proposal.get("role_id") or "shared"), {
            "proposalId": proposal.get("id", proposal_id), "status": proposal.get("status", "unknown"),
            "actionType": proposal.get("action_type", ""), "riskLevel": proposal.get("risk_level", ""),
            "receiptId": (result.get("receipt") or {}).get("id", ""),
            "idempotent": bool(result.get("idempotent")),
        })
        return {"ok": True, **result}

    def _sync_extension_state(self) -> None:
        now = utc_now()
        with closing(self.connect()) as database, database:
            current_ids = {package.id for package in self.extension_catalog.packages}
            stale_ids = {row['id'] for row in database.execute('SELECT id FROM extension_state')} - current_ids
            for stale_id in stale_ids:
                database.execute('DELETE FROM extension_state WHERE id=?', (stale_id,))
            for package in self.extension_catalog.packages:
                row = database.execute("SELECT * FROM extension_state WHERE id=?", (package.id,)).fetchone()
                if row is None:
                    enabled = bool(package.default_enabled and package.source == "bundled")
                    database.execute(
                        "INSERT INTO extension_state(id,enabled,updated_at,content_hash,reviewed_hash) VALUES(?,?,?,?,?)",
                        (package.id, 1 if enabled else 0, now, package.content_hash, package.content_hash if enabled else ""),
                    )
                    continue
                enabled = bool(row["enabled"])
                reviewed_hash = str(row["reviewed_hash"] or "")
                if package.source == "user" and reviewed_hash != package.content_hash:
                    enabled = False
                if bool(row['enabled']) != enabled or row['content_hash'] != package.content_hash:
                    database.execute(
                        "UPDATE extension_state SET enabled=?,updated_at=?,content_hash=? WHERE id=?",
                        (1 if enabled else 0, now, package.content_hash, package.id),
                    )

    def list_extensions(self, *, refresh: bool = False) -> dict[str, Any]:
        if refresh:
            self.extension_catalog = self.extension_registry.scan()
            self._sync_extension_state()
        with closing(self.connect()) as database:
            states = {
                row["id"]: {
                    "enabled": bool(row["enabled"]), "updatedAt": row["updated_at"],
                    "contentHash": row["content_hash"], "reviewedHash": row["reviewed_hash"],
                }
                for row in database.execute("SELECT * FROM extension_state").fetchall()
            }
        packages = []
        for package in self.extension_catalog.packages:
            state = states.get(package.id, {"enabled": False, "updatedAt": "", "reviewedHash": ""})
            requires_review = package.source == "user" and state.get("reviewedHash") != package.content_hash
            packages.append({**package.to_dict(), **state, "requiresReview": requires_review})
        return {
            "packages": packages,
            "errors": [dict(item) for item in self.extension_catalog.errors],
            "packageCount": len(packages),
            "enabledCount": sum(item["enabled"] for item in packages),
            "officeCapabilities": self.office_runtime.capabilities(),
            "root": str(self.extension_root), "userRoot": str(self.user_extension_root),
        }

    def set_extension_enabled(self, package_id: str, enabled: Any) -> dict[str, Any]:
        package_id = package_id.strip()
        if not package_id:
            raise ValueError("extension_id_required")
        if not isinstance(enabled, bool):
            raise ValueError("extension_enabled_must_be_boolean")
        packages = {item.id: item for item in self.extension_catalog.packages}
        if package_id not in packages:
            raise ValueError("unknown_extension")
        updated_at = utc_now()
        package = packages[package_id]
        with closing(self.connect()) as database, database:
            database.execute(
                "INSERT INTO extension_state(id,enabled,updated_at,content_hash,reviewed_hash) VALUES(?,?,?,?,?) "
                "ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled,updated_at=excluded.updated_at,"
                "content_hash=excluded.content_hash,reviewed_hash=excluded.reviewed_hash",
                (package_id, 1 if enabled else 0, updated_at, package.content_hash, package.content_hash),
            )
        return {
            "id": package_id, "enabled": enabled, "updatedAt": updated_at,
            "reviewedHash": package.content_hash, "requiresReview": False,
        }

    def extension_credential_definitions(self, *, refresh: bool = False) -> dict[str, dict[str, Any]]:
        definitions: dict[str, dict[str, Any]] = {}
        for package in self.list_extensions(refresh=refresh)["packages"]:
            active = bool(package.get("enabled") and not package.get("requiresReview"))
            for slot in package.get("credentialSlots") or []:
                slot_id = str(slot.get("slotId") or "")
                if not slot_id:
                    continue
                definitions[slot_id] = {
                    "label": str(slot.get("label") or slot.get("id") or slot_id),
                    "description": str(slot.get("description") or ""),
                    "packageId": str(package.get("id") or ""),
                    "packageName": str(package.get("name") or package.get("id") or ""),
                    "active": active,
                    "enabled": bool(package.get("enabled")),
                    "requiresReview": bool(package.get("requiresReview")),
                }
        return definitions

    def extension_enabled(self, package_id: str) -> bool:
        with closing(self.connect()) as database:
            row = database.execute("SELECT enabled FROM extension_state WHERE id=?", (package_id,)).fetchone()
        return bool(row and row["enabled"])

    def _require_extension(self, package_id: str) -> None:
        if not self.extension_enabled(package_id):
            raise PermissionError(f"extension_disabled:{package_id}")

    def extension_status(self) -> dict[str, Any]:
        catalog = self.list_extensions()
        active_skills = sum(len(item.get("skills") or []) for item in catalog["packages"] if item["enabled"] and item["type"] == "skill" and not item["requiresReview"])
        return {
            "packageCount": catalog["packageCount"],
            "enabledCount": catalog["enabledCount"],
            "errorCount": len(catalog["errors"]),
            "activeSkillCount": active_skills,
            "officeCapabilities": catalog["officeCapabilities"],
        }

    def active_skill_instructions(self, context: str = "agent", include_roleplay: bool = True) -> dict[str, Any]:
        # Compatibility entry point: names/descriptions only, never all bodies.
        return self.role_skills.prompt_context(context=context, include_roleplay=include_roleplay)

    def _set_run_status(self, run_id: str, **changes: Any) -> dict[str, Any]:
        with self._run_lock:
            current = self._run_status.get(run_id, {"id": run_id, "status": "running", "phase": "starting", "iteration": 0, "updatedAt": utc_now()})
            current = {**current, **changes, "updatedAt": utc_now()}
            self._run_status[run_id] = current
            if len(self._run_status) > 100:
                oldest = next((key for key in self._run_status if key != run_id and key not in self._run_cancel), None)
                if oldest:
                    self._run_status.pop(oldest, None)
            return dict(current)

    def run_status(self, run_id: str) -> dict[str, Any]:
        with self._run_lock:
            active = self._run_status.get(run_id)
            if active:
                return dict(active)
        with closing(self.connect()) as database:
            row = database.execute("SELECT status,output_json,finished_at FROM tasks WHERE id=?", (run_id,)).fetchone()
        if not row:
            return {"id": run_id, "status": "missing", "phase": "unknown", "iteration": 0}
        try:
            output = json.loads(row["output_json"] or "{}")
        except json.JSONDecodeError:
            output = {}
        return {
            "id": run_id, "status": row["status"], "phase": "finished", "iteration": 0,
            "error": output.get("error", ""), "finishedAt": row["finished_at"], "persisted": True,
        }

    def cancel_run(self, run_id: str) -> dict[str, Any]:
        with self._run_lock:
            event = self._run_cancel.get(run_id)
            if not event:
                return {"ok": False, "id": run_id, "error": "run_not_active"}
            event.set()
        return {"ok": True, **self._set_run_status(run_id, status="cancelling", phase="cancelling")}

    def model_tool_definitions(self) -> list[dict[str, Any]]:
        return self.registry.model_definitions()

    def worldbook_for_mode(self,mode='normal'):
        checked_mode(mode)
        return self.worldbooks

    def worldbook_for_role(self,role_id):
        return self.worldbook_for_mode(role_mode(role_id))

    def _request_model(
        self,
        provider: dict[str, Any],
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
    ) -> dict[str, Any]:
        endpoint = str(provider.get("endpoint") or "").strip()
        api_key = str(provider.get("apiKey") or "").strip()
        model = str(provider.get("model") or provider.get("modelRoute") or "").strip()
        if not endpoint or not api_key or not model:
            raise ValueError("provider_config_incomplete")
        body = {
            "model": model,
            "messages": messages,
            "tools": tools,
            "tool_choice": "auto",
            "temperature": max(0.0, min(2.0, float(provider.get("temperature",0.4)))),
            "max_tokens": max(64, min(8192, int(provider.get("maxTokens") or 768))),
            "stream": False,
        }
        if any(m.get('role')=='system' and isinstance(m.get('content'),str) and m['content'].startswith('[scene-response-v1]') for m in messages):
            body['response_format']={'type':'json_object'}
        if model in {"deepseek-flash","deepseek-chat","deepseek-reasoner"} or model.startswith("deepseek-v4-"):
            body["thinking"] = {"type": "enabled" if provider.get("thinking") is True or model=="deepseek-reasoner" else "disabled"}
            if provider.get("thinking") is True:
                body["max_tokens"] = max(2048, body["max_tokens"])
                prompt=self.worldbook_for_mode(provider.get('personaMode','normal')).catalog()['presentation']['reasoningLanguagePrompt']
                body['messages']=[{'role':'system','content':prompt},*messages]
        return self._post_provider_json(provider, body, MAX_MODEL_BYTES)["payload"]

    def _post_provider_json(
        self,
        provider: dict[str, Any],
        body: dict[str, Any],
        response_limit: int,
    ) -> dict[str, Any]:
        endpoint = str(provider.get("endpoint") or "").strip()
        api_key = str(provider.get("apiKey") or "").strip()
        if not endpoint or not api_key:
            raise ValueError("provider_config_incomplete")
        validate_provider_url(endpoint)
        encoded = json.dumps(body, ensure_ascii=False).encode("utf-8")
        if len(encoded) > MAX_PROVIDER_REQUEST_BYTES:
            raise ValueError("provider_request_too_large")
        request = urllib.request.Request(endpoint, data=encoded, method="POST", headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
            "User-Agent": "HermesProject5/1.0 (+local-personal-agent)",
        })
        opener = urllib.request.build_opener(DenyRedirectHandler())
        try:
            with opener.open(request, timeout=max(2, min(120, int(provider.get("timeoutSeconds") or 20)))) as response:
                if "json" not in str(response.headers.get("Content-Type") or "").lower():
                    raise ValueError("provider_json_required")
                raw = response.read(response_limit + 1)
                if len(raw) > response_limit:
                    raise ValueError("provider_response_too_large")
                final_url = response.geturl()
                if final_url != endpoint:
                    raise PermissionError("provider_redirect_blocked")
                status = int(getattr(response, "status", 200))
                request_id = str(response.headers.get("x-request-id") or response.headers.get("request-id") or "")[:200]
        except urllib.error.HTTPError as error:
            raw_error = error.read(16_385)
            detail = ""
            if len(raw_error) <= 16_384:
                try:
                    error_payload = json.loads(raw_error.decode("utf-8"))
                    detail = str(error_payload.get("error", {}).get("message") or error_payload.get("message") or "")
                except (UnicodeDecodeError, json.JSONDecodeError, AttributeError):
                    detail = raw_error.decode("utf-8", errors="replace")
            request_id = str(error.headers.get("x-request-id") or error.headers.get("request-id") or "")[:200]
            print(f"[provider-http-diag] {int(error.code)}: {detail.strip()[:300]}", file=sys.stderr, flush=True)
            raise ProviderHTTPError(int(error.code), detail.strip()[:1000], request_id) from error
        except urllib.error.URLError as error:
            print(f"[provider-net-diag] {type(error).__name__}: {str(error)[:300]}", file=sys.stderr, flush=True)
            raise ValueError("provider_request_failed") from error
        payload = json.loads(raw.decode("utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("provider_invalid_response")
        return {"ok": True, "payload": payload, "httpStatus": status, "requestId": request_id}

    def proxy_provider_request(self, request_payload: dict[str, Any]) -> dict[str, Any]:
        route = str(request_payload.get("route") or "").strip().lower()
        if route not in {"chat", "image", "voice"}:
            raise ValueError("provider_route_unsupported")
        provider = request_payload.get("provider") if isinstance(request_payload.get("provider"), dict) else {}
        body = request_payload.get("body") if isinstance(request_payload.get("body"), dict) else {}
        endpoint = str(provider.get("endpoint") or "").strip()
        model = str(provider.get("model") or provider.get("modelRoute") or "").strip()
        if not endpoint or not str(provider.get("apiKey") or "").strip() or not model:
            raise ValueError("provider_config_incomplete")
        if str(body.get("model") or "").strip() != model:
            raise ValueError("provider_model_mismatch")
        if body.get("stream") not in {None, False}:
            raise ValueError("provider_streaming_unsupported")
        endpoint_path = urllib.parse.urlparse(endpoint).path.rstrip("/").lower()
        if route in {"chat", "voice"}:
            if not endpoint_path.endswith("/chat/completions") or not isinstance(body.get("messages"), list):
                raise ValueError(f"provider_{route}_payload_invalid")
            if not body["messages"] or len(body["messages"]) > 4096:
                raise ValueError(f"provider_{route}_payload_invalid")
            self._validate_chat_messages(body["messages"])
            if route == "voice":
                audio = body.get("audio") if isinstance(body.get("audio"), dict) else {}
                voice = str(audio.get("voice") or "").strip()
                audio_format = str(audio.get("format") or "wav").strip().lower()
                speed = audio.get("speed", 1)
                if not voice or len(voice) > 4096 or audio_format not in {"wav", "mp3"}:
                    raise ValueError("provider_voice_payload_invalid")
                if not isinstance(speed, (int, float)) or isinstance(speed, bool) or not 0.5 <= float(speed) <= 2.0:
                    raise ValueError("provider_voice_speed_invalid")
                response_limit = MAX_AUDIO_RESPONSE_BYTES
            else:
                response_limit = MAX_MODEL_BYTES
        else:
            if not (endpoint_path.endswith("/images/generations") or endpoint_path.endswith("/responses")):
                raise ValueError("provider_image_endpoint_invalid")
            if not str(body.get("prompt") or body.get("input") or "").strip():
                raise ValueError("provider_image_payload_invalid")
            response_limit = MAX_IMAGE_RESPONSE_BYTES
        if route=='chat':
            from current_character_context import add_current_character_context
            body=add_current_character_context(self,body,str(request_payload.get('roleId') or ''),request_payload.get('roleSkills'))
        if route=='chat':
            from role_skills import appointment_turn_options
            request_payload={**request_payload,'roleSkills':appointment_turn_options(self,str(request_payload.get('roleId') or ''),request_payload.get('roleSkills'),body['messages'])}
        turn = None
        if route == 'chat' and isinstance(request_payload.get('roleSkills'), dict) and request_payload['roleSkills'].get('enabled') is True:
            turn = RoleSkillTurn(self, str(request_payload.get('roleId') or ''), request_payload['roleSkills'])
            body = turn.prepare(body)
        total_usage = {}
        try:
            while True:
                result = self._post_provider_json(provider, body, response_limit)
                if turn and isinstance(result['payload'].get('usage'), dict):
                    for key, value in result['payload']['usage'].items():
                        if key in {'prompt_tokens', 'completion_tokens', 'total_tokens', 'prompt_cache_hit_tokens', 'prompt_cache_miss_tokens'} and type(value) is int and 0 <= value <= 10_000_000:
                            total_usage[key] = total_usage.get(key, 0) + value
                if not turn:
                    break
                message = self._model_message(result['payload'])
                if not message.get('tool_calls'):
                    break
                if (result['payload'].get('choices') or [{}])[0].get('finish_reason') not in {None, 'tool_calls'}:
                    raise ValueError('provider_incomplete_skill_call')
                body = turn.accept(body, message)
        except ProviderHTTPError as error:
            return {
                "ok": False,
                "route": route,
                "origin": "provider",
                "httpStatus": error.status,
                "requestId": error.request_id,
                "error": {"message": error.detail},
            }
        if route == "chat":
            self._model_message(result["payload"])
        elif route == "voice":
            self._validate_audio_payload(result["payload"])
        elif not self._has_image_payload(result["payload"]):
            raise ValueError("provider_missing_image")
        if turn and total_usage:
            result['payload']['usage'] = {**total_usage, **({'context_prompt_tokens':result['payload']['usage']['prompt_tokens']} if 'prompt_tokens' in result['payload'].get('usage',{}) else {})}
        if route in ACCEPTANCE_CHANNELS:
            self.record_provider_acceptance(route, provider, result)
        return {**result, "route": route, **({'skillActivity': turn.receipts} if turn else {})}

    @staticmethod
    def _validate_chat_messages(messages: list[dict[str, Any]]) -> None:
        image_count = 0
        total_bytes = 0
        for message in messages:
            if not isinstance(message, dict):
                raise ValueError("provider_chat_payload_invalid")
            content = message.get("content")
            if isinstance(content, str) or content is None:
                continue
            if not isinstance(content, list):
                raise ValueError("provider_chat_payload_invalid")
            for part in content:
                if not isinstance(part, dict):
                    raise ValueError("provider_chat_payload_invalid")
                if part.get("type") != "image_url":
                    continue
                image = part.get("image_url") if isinstance(part.get("image_url"), dict) else {}
                url = str(image.get("url") or "")
                match = re.fullmatch(r"data:([^;,]+);base64,([A-Za-z0-9+/=\r\n]+)", url)
                if not match or match.group(1).lower() not in VISION_MIME_TYPES:
                    raise ValueError("provider_vision_image_invalid")
                try:
                    byte_size = len(base64.b64decode(match.group(2), validate=True))
                except (binascii.Error, ValueError):
                    raise ValueError("provider_vision_image_invalid") from None
                if byte_size <= 0 or byte_size > MAX_VISION_IMAGE_BYTES:
                    raise ValueError("provider_vision_image_too_large")
                image_count += 1
                total_bytes += byte_size
        if image_count > 4 or total_bytes > MAX_VISION_TOTAL_BYTES:
            raise ValueError("provider_vision_batch_too_large")

    @staticmethod
    def _has_image_payload(payload: dict[str, Any]) -> bool:
        data = payload.get("data") if isinstance(payload.get("data"), list) else []
        output = payload.get("output") if isinstance(payload.get("output"), list) else []
        candidates = [payload, *(item for item in data if isinstance(item, dict)), *(item for item in output if isinstance(item, dict))]
        return any(item.get("b64_json") or item.get("b64") or item.get("result") or item.get("url") for item in candidates)

    @staticmethod
    def _validate_audio_payload(payload: dict[str, Any]) -> None:
        choices = payload.get("choices") if isinstance(payload.get("choices"), list) else []
        message = choices[0].get("message") if choices and isinstance(choices[0], dict) else None
        audio = message.get("audio") if isinstance(message, dict) and isinstance(message.get("audio"), dict) else {}
        raw_data = str(audio.get("data") or "").strip()
        if raw_data.startswith("data:"):
            match = re.fullmatch(r"data:(audio/(?:wav|x-wav|mpeg));base64,([A-Za-z0-9+/=\r\n]+)", raw_data, re.IGNORECASE)
            if not match:
                raise ValueError("provider_audio_invalid")
            raw_data = match.group(2)
        try:
            decoded = base64.b64decode(raw_data, validate=True)
        except (binascii.Error, ValueError):
            raise ValueError("provider_audio_invalid") from None
        if not decoded or len(decoded) > MAX_AUDIO_RESPONSE_BYTES:
            raise ValueError("provider_audio_invalid")
        is_wav = len(decoded) >= 12 and decoded[:4] == b"RIFF" and decoded[8:12] == b"WAVE"
        is_mp3 = decoded[:3] == b"ID3" or (len(decoded) >= 2 and decoded[0] == 0xFF and decoded[1] & 0xE0 == 0xE0)
        if not (is_wav or is_mp3):
            raise ValueError("provider_audio_invalid")

    def record_provider_acceptance(
        self,
        channel: str,
        provider: dict[str, Any],
        result: dict[str, Any],
        *,
        result_count: int = 0,
    ) -> dict[str, Any]:
        clean_channel = str(channel or "").strip().lower()
        if clean_channel not in ACCEPTANCE_CHANNELS:
            raise ValueError("acceptance_channel_invalid")
        endpoint = urllib.parse.urlparse(str(provider.get("endpoint") or ""))
        now = utc_now()
        receipt = {
            "channel": clean_channel,
            "status": "passed",
            "executionMode": "live",
            "provider": str(provider.get("type") or endpoint.hostname or "provider")[:120],
            "model": str(provider.get("model") or provider.get("modelRoute") or "")[:200],
            "httpStatus": int(result.get("httpStatus") or 200),
            "requestId": str(result.get("requestId") or "")[:200],
            "resultCount": max(0, int(result_count or 0)),
            "passedAt": now,
        }
        with closing(self.connect()) as database, database:
            database.execute(
                """INSERT INTO provider_acceptance_receipts(channel,receipt_json,accepted_at,updated_at)
                   VALUES(?,?,?,?) ON CONFLICT(channel) DO UPDATE SET
                   receipt_json=excluded.receipt_json,accepted_at=excluded.accepted_at,updated_at=excluded.updated_at""",
                (clean_channel, json.dumps(receipt, ensure_ascii=False), now, now),
            )
        return receipt

    def provider_acceptance(self) -> dict[str, Any]:
        evidence: dict[str, Any] = {channel: None for channel in sorted(ACCEPTANCE_CHANNELS)}
        with closing(self.connect()) as database:
            for row in database.execute("SELECT channel,receipt_json FROM provider_acceptance_receipts"):
                if row["channel"] in ACCEPTANCE_CHANNELS:
                    evidence[row["channel"]] = json.loads(row["receipt_json"])
        passed = [channel for channel in sorted(ACCEPTANCE_CHANNELS) if evidence[channel]]
        return {"ok": True, "evidence": evidence, "passed": passed, "missing": sorted(ACCEPTANCE_CHANNELS - set(passed))}

    def invalidate_provider_acceptance(self, channels: list[str]) -> dict[str, Any]:
        clean = sorted({str(channel).strip().lower() for channel in channels if str(channel).strip().lower() in ACCEPTANCE_CHANNELS})
        if not clean:
            raise ValueError("acceptance_channels_required")
        with closing(self.connect()) as database, database:
            database.executemany("DELETE FROM provider_acceptance_receipts WHERE channel=?", [(channel,) for channel in clean])
        return {"ok": True, "invalidated": clean, **self.provider_acceptance()}

    @staticmethod
    def _model_message(payload: dict[str, Any]) -> dict[str, Any]:
        choices = payload.get("choices")
        if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
            raise ValueError("provider_missing_choice")
        message = choices[0].get("message")
        if not isinstance(message, dict):
            raise ValueError("provider_missing_message")
        return message

    def run_agent(self, payload: dict[str, Any], model_call=None) -> dict[str, Any]:
        return AgentExecutor(self, utc_now, validate_public_https).run(payload, model_call)

    def _safe_search_provider(self, provider: dict[str, Any]) -> dict[str, Any]:
        raw_endpoint = str(provider.get("endpoint") or "").strip()
        parsed = urllib.parse.urlparse(raw_endpoint)
        endpoint = urllib.parse.urlunparse((parsed.scheme, parsed.netloc.rsplit("@", 1)[-1], parsed.path, "", "", "")) if parsed.scheme and parsed.netloc else ""
        return {"type": str(provider.get("type") or "generic_get"), "endpoint": endpoint}

    def search_web(self, query: str, provider: dict[str, Any], limit: int = 6) -> dict[str, Any]:
        clean_query = " ".join(query.split())[:500]
        if not clean_query:
            raise ValueError("search_query_required")
        provider_type = str(provider.get("type") or "generic_get").strip().lower()
        if provider_type not in {"brave", "generic_get"}:
            raise ValueError("search_provider_unsupported")
        endpoint = str(provider.get("endpoint") or "").strip()
        api_key = str(provider.get("apiKey") or "").strip()
        parsed = validate_public_https(endpoint)
        if parsed.query or parsed.fragment:
            raise PermissionError("search_endpoint_query_forbidden")
        if not api_key:
            raise ValueError("search_provider_key_required")
        safe_limit = max(1, min(10, int(limit or 6)))
        params = urllib.parse.urlencode({"q": clean_query, "count": safe_limit})
        request_url = urllib.parse.urlunparse((parsed.scheme, parsed.netloc, parsed.path, "", params, ""))
        auth_header = "X-Subscription-Token" if provider_type == "brave" else str(provider.get("authHeader") or "Authorization")
        if auth_header.lower() not in {"authorization", "x-subscription-token", "x-api-key"}:
            raise ValueError("search_auth_header_unsupported")
        auth_value = api_key if auth_header.lower() != "authorization" else f"Bearer {api_key}"
        request = urllib.request.Request(request_url, headers={
            "Accept": "application/json",
            "User-Agent": "HermesProject5/1.0",
            auth_header: auth_value,
        })
        opener = urllib.request.build_opener(PublicHttpsRedirectHandler())
        try:
            with opener.open(request, timeout=max(2, min(20, int(provider.get("timeoutSeconds") or 8)))) as response:
                if "json" not in str(response.headers.get("Content-Type") or "").lower():
                    raise ValueError("search_provider_json_required")
                raw = response.read(MAX_WEB_BYTES + 1)
                if len(raw) > MAX_WEB_BYTES:
                    raise ValueError("search_response_too_large")
                http_status = int(getattr(response, "status", 200))
                request_id = str(response.headers.get("x-request-id") or response.headers.get("request-id") or "")[:200]
        except urllib.error.HTTPError as error:
            raise ValueError(f"search_provider_http_{error.code}") from error
        except urllib.error.URLError as error:
            raise ValueError("search_provider_request_failed") from error
        try:
            payload = json.loads(raw.decode("utf-8", errors="replace"))
        except json.JSONDecodeError as error:
            raise ValueError("search_provider_invalid_json") from error
        candidates = payload.get("results", []) if isinstance(payload, dict) else []
        if provider_type == "brave" and isinstance(payload, dict):
            web = payload.get("web") if isinstance(payload.get("web"), dict) else {}
            candidates = web.get("results", [])
        items = []
        for candidate in candidates if isinstance(candidates, list) else []:
            if not isinstance(candidate, dict):
                continue
            url = str(candidate.get("url") or "").strip()
            try:
                validate_public_https(url)
            except (ValueError, PermissionError):
                continue
            items.append({
                "title": str(candidate.get("title") or url)[:300],
                "url": url,
                "snippet": str(candidate.get("description") or candidate.get("snippet") or "")[:1200],
            })
            if len(items) >= safe_limit:
                break
        receipt = self.record_provider_acceptance(
            "search",
            {"type": provider_type, "endpoint": endpoint},
            {"httpStatus": http_status, "requestId": request_id},
            result_count=len(items),
        )
        return {"query": clean_query, "items": items, "empty": not items, "provider": provider_type, "acceptance": receipt}

    def search_knowledge(self, query: str, limit: int = 6, paths: list[str] | None = None) -> dict[str, Any]:
        query = query.strip()
        if not query:
            raise ValueError("query_required")
        limit = max(1, min(12, limit))
        targets = self._approved_targets(paths or [])
        if paths and len(targets) != len({Path(str(path)).expanduser().resolve() for path in paths}):
            raise PermissionError("knowledge_scope_unavailable")
        if not paths:
            targets = self.knowledge_roots
        if not targets:
            return {"query": query, "items": [], "empty": True, "reason": "no_knowledge_roots"}
        items = self._rg_search(query, limit, targets) if shutil.which("rg") else self._python_search(query, limit, targets)
        return {"query": query, "items": items, "empty": not items, "searchedRoots": [str(root) for root in targets]}

    def _approved_targets(self, paths: list[str]) -> list[Path]:
        targets: list[Path] = []
        for raw_path in paths[:20]:
            candidate = Path(str(raw_path)).expanduser().resolve()
            if candidate.exists() and any(candidate == root or root in candidate.parents for root in self.knowledge_roots):
                targets.append(candidate)
        return list(dict.fromkeys(targets))

    def _rg_search(self, query: str, limit: int, targets: list[Path]) -> list[dict[str, Any]]:
        terms = [term for term in re.split(r"[\s,，;；]+", query) if len(term) >= 2][:8]
        command = [shutil.which("rg") or "rg", "--json", "-i", "--max-count", "3"]
        for pattern in TEXT_GLOBS:
            command.extend(["-g", pattern])
        command.extend(["|".join(re.escape(term) for term in terms) or re.escape(query), *map(str, targets)])
        try:
            result = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=10, check=False)
        except subprocess.TimeoutExpired:
            return []
        items: list[dict[str, Any]] = []
        for line in result.stdout.splitlines():
            try:
                event = json.loads(line)
                if event.get("type") != "match":
                    continue
                data = event["data"]
                items.append({
                    "path": data["path"]["text"], "line": int(data.get("line_number") or 1),
                    "excerpt": " ".join(data["lines"]["text"].strip().split())[:360],
                })
                if len(items) >= limit:
                    break
            except (KeyError, TypeError, ValueError, json.JSONDecodeError):
                continue
        return items

    def _python_search(self, query: str, limit: int, targets: list[Path]) -> list[dict[str, Any]]:
        terms = [term.casefold() for term in re.split(r"[\s,，;；]+", query) if len(term) >= 2]
        items: list[dict[str, Any]] = []
        for root in targets:
            candidates = [root] if root.is_file() else root.rglob("*")
            for path in candidates:
                if len(items) >= limit:
                    return items
                if not path.is_file() or not any(path.match(pattern) for pattern in TEXT_GLOBS) or path.stat().st_size > 2_000_000:
                    continue
                try:
                    for line_number, line in enumerate(path.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
                        if any(term in line.casefold() for term in terms):
                            items.append({"path": str(path), "line": line_number, "excerpt": " ".join(line.split())[:360]})
                            break
                except OSError:
                    continue
        return items

    def fetch_web_sources(self, urls: list[str], query: str = "") -> dict[str, Any]:
        if not urls:
            raise ValueError("web_urls_required")
        opener = urllib.request.build_opener(PublicHttpsRedirectHandler())
        items: list[dict[str, Any]] = []
        failures: list[dict[str, str]] = []
        for url in list(dict.fromkeys(urls))[:4]:
            try:
                validate_public_https(url)
                request = urllib.request.Request(url, headers={"User-Agent": "HermesProject5/1.0 (+local-personal-agent)"})
                with opener.open(request, timeout=8) as response:
                    content_type = response.headers.get_content_type()
                    if content_type not in {"text/html", "text/plain", "application/json"}:
                        raise ValueError("web_unsupported_content_type")
                    raw = response.read(MAX_WEB_BYTES + 1)
                    if len(raw) > MAX_WEB_BYTES:
                        raise ValueError("web_response_too_large")
                    encoding = response.headers.get_content_charset() or "utf-8"
                    content = raw.decode(encoding, errors="replace")
                    final_url = response.geturl()
                    validate_public_https(final_url)
                if content_type == "text/html":
                    parser = TextExtractor()
                    parser.feed(content)
                    text_content = " ".join(parser.parts)
                    title = parser.title or urllib.parse.urlparse(final_url).hostname or final_url
                else:
                    text_content = " ".join(content.split())
                    title = urllib.parse.urlparse(final_url).hostname or final_url
                terms = [term.casefold() for term in re.split(r"[\s,，;；]+", query) if len(term) >= 2]
                sentences = re.split(r"(?<=[.!?。！？])\s+|\s{2,}", html.unescape(text_content))
                matching = [sentence for sentence in sentences if any(term in sentence.casefold() for term in terms)]
                excerpt = " ".join((matching or sentences)[:4])[:900]
                items.append({"url": final_url, "title": title[:180], "excerpt": excerpt})
            except Exception as error:
                failures.append({"url": url, "error": str(error) or type(error).__name__})
        return {"query": query, "items": items, "failures": failures, "empty": not items}

    def save_memory(self, args: dict[str, Any]) -> dict[str, Any]:
        content = str(args.get("content") or "").strip()
        if not content:
            raise ValueError("memory_content_required")
        status = str(args.get("status") or "active").strip().lower()
        if status not in MEMORY_STATUSES:
            raise ValueError("memory_status_invalid")
        item_id = str(args.get("id") or f"memory-{uuid.uuid4().hex}")
        now = utc_now()
        values = (
            item_id, str(args.get("roleId") or "shared"), str(args.get("kind") or "task_result"), content[:12000],
            str(args.get("source") or "agent_runtime"), max(0.0, min(1.0, float(args.get("confidence") or .75))),
            status, now, now,
        )
        with closing(self.connect()) as database, database:
            existing = database.execute("SELECT role_id FROM memories WHERE id=?", (item_id,)).fetchone()
            if existing is not None and existing["role_id"] != values[1]:
                raise ValueError("memory_role_mismatch")
            database.execute(
                "INSERT INTO memories VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET content=excluded.content,source=excluded.source,confidence=excluded.confidence,status=excluded.status,updated_at=excluded.updated_at",
                values,
            )
        return {"id": item_id, "roleId": values[1], "kind": values[2], "status": values[6], "updatedAt": now}

    def search_memories(self, query: str, role_id: str = "", limit: int = 8) -> dict[str, Any]:
        clauses, params = ["status='active'"], []
        if role_id:
            clauses.append("role_id=?")
            params.append(role_id)
        terms = [term for term in re.split(r"[\s,，;；]+", query.strip()) if term]
        if terms:
            clauses.append("(" + " AND ".join("content LIKE ?" for _ in terms) + ")")
            params.extend(f"%{term}%" for term in terms)
        params.append(max(1, min(12, limit)))
        with closing(self.connect()) as database, database:
            rows = database.execute("SELECT * FROM memories WHERE " + " AND ".join(clauses) + " ORDER BY updated_at DESC LIMIT ?", params).fetchall()
        items=[dict(row) for row in rows]
        if role_id and role_id!='shared':
            evidence=self.role_workspace.context({'roleId':role_id,'query':query})['memories']
            items.extend({'id':m['id'],'role_id':role_id,'kind':m['type'],'content':m['text'],'source':m['origin'],'evidence':m['evidence'],'status':'active'} for m in evidence)
        return {"query": query, "items": items[:max(1,min(12,limit))], "empty": not items}

    def office_for_role(self,role_id):
        if not role_id or role_id=='shared':return self.office_runtime
        directory=self.role_workspace.role_directory(role_id)
        return OfficeRuntime(directory/'office',[directory])

    @staticmethod
    def _decode_memory_relation(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "roleId": row["role_id"],
            "relationType": row["relation_type"],
            "reason": row["reason_code"],
            "status": row["status"],
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
            "subject": {
                "id": row["subject_id"], "kind": row["subject_kind"],
                "content": row["subject_content"], "source": row["subject_source"],
                "confidence": row["subject_confidence"], "status": row["subject_status"],
            },
            "object": {
                "id": row["object_id"], "kind": row["object_kind"],
                "content": row["object_content"], "source": row["object_source"],
                "confidence": row["object_confidence"], "status": row["object_status"],
            },
        }

    @staticmethod
    def _memory_relation_query() -> str:
        return """
            SELECT r.*,
                subject.kind AS subject_kind,subject.content AS subject_content,
                subject.source AS subject_source,subject.confidence AS subject_confidence,
                subject.status AS subject_status,
                object.kind AS object_kind,object.content AS object_content,
                object.source AS object_source,object.confidence AS object_confidence,
                object.status AS object_status
            FROM memory_relations r
            JOIN memories subject ON subject.id=r.subject_id
            JOIN memories object ON object.id=r.object_id
        """

    def list_memory_conflicts(self, role_id: str = "", status: str = "", limit: int = 50) -> dict[str, Any]:
        normalized_status = status.strip().lower()
        if normalized_status and normalized_status not in MEMORY_RELATION_STATUSES:
            raise ValueError("memory_conflict_status_invalid")
        clauses: list[str] = []
        params: list[Any] = []
        if role_id:
            clauses.append("r.role_id=?")
            params.append(role_id)
        if normalized_status:
            clauses.append("r.status=?")
            params.append(normalized_status)
        sql = self._memory_relation_query()
        if clauses:
            sql += " WHERE " + " AND ".join(clauses)
        sql += " ORDER BY r.updated_at DESC LIMIT ?"
        params.append(max(1, min(100, limit)))
        with closing(self.connect()) as database:
            rows = database.execute(sql, params).fetchall()
        items = [self._decode_memory_relation(row) for row in rows]
        return {"items": items, "empty": not items}

    def resolve_memory_conflict(self, args: dict[str, Any]) -> dict[str, Any]:
        subject_id = str(args.get("subjectId") or "").strip()
        object_id = str(args.get("objectId") or "").strip()
        reason = str(args.get("reason") or "").strip().lower()
        requested_role = str(args.get("roleId") or "").strip()
        if reason not in MEMORY_RELATION_REASONS:
            raise ValueError("memory_conflict_reason_invalid")
        if not subject_id or not object_id:
            raise ValueError("memory_conflict_memory_missing")
        if subject_id == object_id:
            raise ValueError("memory_conflict_same_id")
        now = utc_now()
        with closing(self.connect()) as database, database:
            rows = database.execute(
                "SELECT * FROM memories WHERE id IN (?,?)", (subject_id, object_id)
            ).fetchall()
            memories = {row["id"]: row for row in rows}
            if subject_id not in memories or object_id not in memories:
                raise ValueError("memory_conflict_memory_missing")
            subject, object_ = memories[subject_id], memories[object_id]
            if subject["role_id"] != object_["role_id"] or (requested_role and requested_role != subject["role_id"]):
                raise ValueError("memory_conflict_role_mismatch")
            if subject["status"] == "deleted" or object_["status"] == "deleted":
                raise ValueError("memory_conflict_deleted")
            if object_["status"] != "active":
                raise ValueError("memory_conflict_replacement_not_active")
            existing = database.execute(
                "SELECT id,created_at FROM memory_relations WHERE subject_id=? AND object_id=? AND relation_type='supersedes'",
                (subject_id, object_id),
            ).fetchone()
            relation_id = existing["id"] if existing else f"memory-relation-{uuid.uuid4().hex}"
            created_at = existing["created_at"] if existing else now
            database.execute(
                "UPDATE memory_relations SET status='reopened',updated_at=? WHERE subject_id=? AND relation_type='supersedes' AND status='resolved' AND id<>?",
                (now, subject_id, relation_id),
            )
            database.execute(
                """INSERT INTO memory_relations VALUES(?,?,?,?,?,?,?,?,?)
                   ON CONFLICT(subject_id,object_id,relation_type) DO UPDATE SET
                   role_id=excluded.role_id,reason_code=excluded.reason_code,status='resolved',updated_at=excluded.updated_at""",
                (relation_id, subject["role_id"], subject_id, object_id, "supersedes", reason, "resolved", created_at, now),
            )
            database.execute("UPDATE memories SET status='contradicted',updated_at=? WHERE id=?", (now, subject_id))
            row = database.execute(self._memory_relation_query() + " WHERE r.id=?", (relation_id,)).fetchone()
        return self._decode_memory_relation(row)

    def reopen_memory_conflict(self, args: dict[str, Any]) -> dict[str, Any]:
        relation_id = str(args.get("id") or "").strip()
        if not relation_id:
            raise ValueError("memory_conflict_relation_missing")
        now = utc_now()
        with closing(self.connect()) as database, database:
            relation = database.execute("SELECT * FROM memory_relations WHERE id=?", (relation_id,)).fetchone()
            if relation is None:
                raise ValueError("memory_conflict_relation_missing")
            database.execute("UPDATE memory_relations SET status='reopened',updated_at=? WHERE id=?", (now, relation_id))
            remaining = database.execute(
                "SELECT COUNT(*) FROM memory_relations WHERE subject_id=? AND relation_type='supersedes' AND status='resolved'",
                (relation["subject_id"],),
            ).fetchone()[0]
            if remaining == 0:
                database.execute(
                    "UPDATE memories SET status='active',updated_at=? WHERE id=? AND status<>'deleted'",
                    (now, relation["subject_id"]),
                )
            row = database.execute(self._memory_relation_query() + " WHERE r.id=?", (relation_id,)).fetchone()
        return self._decode_memory_relation(row)

    @staticmethod
    def _conversation_identity(role_id: str, session_id: str) -> tuple[str, str]:
        role = role_id.strip()
        session = session_id.strip()
        if not role:
            raise ValueError("conversation_role_required")
        if not session:
            raise ValueError("conversation_session_required")
        if len(role) > 80 or not re.fullmatch(r"[A-Za-z0-9_.:-]+", role):
            raise ValueError("conversation_role_invalid")
        if len(session) > 160 or not re.fullmatch(r"[A-Za-z0-9_.:-]+", session):
            raise ValueError("conversation_session_invalid")
        return role, session

    @staticmethod
    def _conversation_attachments(value: Any) -> list[dict[str, Any]]:
        if value is None:
            return []
        if not isinstance(value, list) or len(value) > 4:
            raise ValueError("conversation_attachments_invalid")
        attachments: list[dict[str, Any]] = []
        for raw in value:
            if not isinstance(raw, dict):
                raise ValueError("conversation_attachments_invalid")
            attachment_id = str(raw.get("id") or "").strip()
            name = re.split(r"[\\/]", str(raw.get("name") or "attachment"))[-1].strip()[:180]
            mime_type = str(raw.get("type") or "").strip().lower()
            try:
                size = int(raw.get("size") or 0)
            except (TypeError, ValueError) as error:
                raise ValueError("conversation_attachment_size_invalid") from error
            if not attachment_id or len(attachment_id) > 160:
                raise ValueError("conversation_attachment_id_invalid")
            if mime_type not in VISION_MIME_TYPES:
                raise ValueError("conversation_attachment_type_invalid")
            if size < 0 or size > MAX_VISION_IMAGE_BYTES:
                raise ValueError("conversation_attachment_size_invalid")
            attachments.append({"id": attachment_id, "name": name or "attachment", "type": mime_type, "size": size})
        return attachments

    @staticmethod
    def _decode_conversation_message(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "sessionId": row["session_id"],
            "roleId": row["role_id"],
            "ordinal": row["ordinal"],
            "sender": row["sender"],
            "text": row["text"],
            "tone": row["tone"],
            "attachments": json.loads(row["attachments_json"]),
            "createdAt": row["created_at"],
        }

    def sync_conversation(self, args: dict[str, Any]) -> dict[str, Any]:
        role, session = self._conversation_identity(
            str(args.get("roleId") or ""), str(args.get("sessionId") or "")
        )
        if role != "shared":
            self.role_workspace.ensure_session(role, session)
        raw_messages = args.get("messages")
        if raw_messages:
            with closing(self.connect()) as db:self.play_runs.require(db,role,session)
        if not isinstance(raw_messages, list) or len(raw_messages) > 500:
            raise ValueError("conversation_messages_invalid")
        prepared: list[tuple[Any, ...]] = []
        for index, raw in enumerate(raw_messages):
            if not isinstance(raw, dict):
                raise ValueError("conversation_message_invalid")
            message_id = str(raw.get("id") or "").strip()
            sender = str(raw.get("sender") or "").strip().lower()
            text = str(raw.get("text") or "").strip()
            tone = str(raw.get("tone") or ("user" if sender == "user" else "role")).strip()[:40]
            created_at = str(raw.get("createdAt") or utc_now()).strip()
            try:
                ordinal = int(raw.get("ordinal") if raw.get("ordinal") is not None else index)
            except (TypeError, ValueError) as error:
                raise ValueError("conversation_ordinal_invalid") from error
            if not message_id or len(message_id) > 160:
                raise ValueError("conversation_message_id_invalid")
            if sender not in {"user", "assistant"}:
                raise ValueError("conversation_sender_invalid")
            if not text:
                raise ValueError("conversation_text_required")
            if len(text) > 20000:
                raise ValueError("conversation_text_too_large")
            if ordinal < 0 or ordinal > 10_000_000:
                raise ValueError("conversation_ordinal_invalid")
            try:
                datetime.fromisoformat(created_at.replace("Z", "+00:00"))
            except ValueError as error:
                raise ValueError("conversation_created_at_invalid") from error
            reasoning = raw.get('reasoning','')
            if not isinstance(reasoning,str) or len(reasoning)>40000 or type(raw.get('reasoningTruncated',False)) is not bool:
                raise ValueError('conversation_reasoning_invalid')
            if sender!='assistant' and reasoning:raise ValueError('conversation_reasoning_sender_invalid')
            notices=raw.get('sceneNotices',[])
            allowed_notices={'format_repaired','parts_skipped','scene_retained','scene_fields_retained','scene_pending','reply_partial'}
            if not isinstance(notices,list) or len(notices)>6 or any(not isinstance(n,str) or n not in allowed_notices for n in notices) or len(set(notices))!=len(notices):
                raise ValueError('conversation_scene_notices_invalid')
            if sender!='assistant' and notices:raise ValueError('conversation_scene_notices_sender_invalid')
            if raw.get('worldUtc') is not None:
                stamp=raw['worldUtc']
                if not isinstance(stamp,str) or len(stamp)>60:raise ValueError('conversation_world_time_invalid')
                try:world_date=datetime.fromisoformat(stamp.replace('Z','+00:00'))
                except ValueError as error:raise ValueError('conversation_world_time_invalid') from error
                if world_date.tzinfo is None:raise ValueError('conversation_world_time_invalid')
            if raw.get('channel') not in {None,'offline','phone'}:raise ValueError('conversation_channel_invalid')
            attachments = self._conversation_attachments(raw.get("attachments"))
            prepared.append((
                message_id, session, role, ordinal, sender, text, tone,
                json.dumps(attachments, ensure_ascii=False, separators=(",", ":")), created_at, "",
            ))
        inserted = 0
        existing = 0
        with closing(self.connect()) as database, database:
            for values in prepared:
                row = database.execute("SELECT * FROM conversation_messages WHERE id=?", (values[0],)).fetchone()
                if row is not None:
                    identity = (row["session_id"], row["role_id"], row["ordinal"], row["sender"], row["text"])
                    if identity != (session, role, values[3], values[4], values[5]):
                        raise ValueError("conversation_message_conflict")
                    existing += 1
                    continue
                occupied = database.execute(
                    "SELECT id FROM conversation_messages WHERE role_id=? AND session_id=? AND ordinal=? AND deleted_at=''",
                    (role, session, values[3]),
                ).fetchone()
                if occupied is not None:
                    raise ValueError("conversation_ordinal_conflict")
                database.execute("INSERT INTO conversation_messages VALUES(?,?,?,?,?,?,?,?,?,?)", values)
                if values[4] == 'user':
                    # Cancel an older idle generation in the same transaction as
                    # the genuine user turn, before a concurrent worker can publish.
                    database.execute("UPDATE auto_moment_roles SET generation=generation+1,status='unarmed',due_at='',error='' WHERE role_id=?", (role,))
                inserted += 1
            for raw in raw_messages:
                if raw.get('channel'):
                    saved=database.execute('SELECT channel FROM conversation_channels WHERE message_id=?',(raw['id'],)).fetchone()
                    if saved and saved['channel']!=raw['channel']:raise ValueError('conversation_channel_conflict')
                    database.execute('INSERT OR IGNORE INTO conversation_channels VALUES(?,?,?)',(raw['id'],raw['channel'],raw.get('worldUtc') or raw.get('createdAt') or utc_now()))
                notices=raw.get('sceneNotices',[])
                if notices:
                    codes=json.dumps(notices,separators=(',',':'))
                    saved=database.execute('SELECT codes_json FROM conversation_scene_notices WHERE message_id=?',(raw['id'],)).fetchone()
                    if saved and saved['codes_json']!=codes:raise ValueError('conversation_scene_notices_conflict')
                    database.execute('INSERT OR IGNORE INTO conversation_scene_notices VALUES(?,?)',(raw['id'],codes))
                reasoning=raw.get('reasoning','')
                if reasoning:
                    saved=database.execute('SELECT text,truncated FROM conversation_reasoning WHERE message_id=?',(raw['id'],)).fetchone()
                    if saved and (saved['text']!=reasoning or bool(saved['truncated'])!=raw.get('reasoningTruncated',False)):
                        raise ValueError('conversation_reasoning_conflict')
                    database.execute('INSERT OR IGNORE INTO conversation_reasoning VALUES(?,?,?)',(raw['id'],reasoning,int(raw.get('reasoningTruncated',False))))
        if role != "shared" and inserted:
            first_user = next((str(raw.get("text") or "") for raw in raw_messages if raw.get("sender") == "user"), "")
            self.role_workspace.touch(role, session, first_user)
        return {"roleId": role, "sessionId": session, "inserted": inserted, "existing": existing, "total": len(prepared)}

    def list_conversation(self, role_id: str, session_id: str, limit: int = 500, after_ordinal: int = -1) -> dict[str, Any]:
        role, session = self._conversation_identity(role_id, session_id)
        bounded = max(1, min(500, int(limit)))
        after = max(-1, int(after_ordinal))
        with closing(self.connect()) as database:
            rows = database.execute(
                """SELECT * FROM conversation_messages
                   WHERE role_id=? AND session_id=? AND deleted_at='' AND ordinal>?
                   ORDER BY ordinal ASC,id ASC LIMIT ?""",
                (role, session, after, bounded + 1),
            ).fetchall()
        has_more = len(rows) > bounded
        page = rows[:bounded]
        items = [self._decode_conversation_message(row) for row in page]
        with closing(self.connect()) as database:
            for item in items:
                channel=database.execute('SELECT channel,world_time FROM conversation_channels WHERE message_id=?',(item['id'],)).fetchone()
                if channel:item.update(channel=channel['channel'],worldUtc=channel['world_time'])
                notice=database.execute('SELECT codes_json FROM conversation_scene_notices WHERE message_id=?',(item['id'],)).fetchone()
                if notice:item['sceneNotices']=json.loads(notice['codes_json'])
                thought=database.execute('SELECT text,truncated FROM conversation_reasoning WHERE message_id=?',(item['id'],)).fetchone()
                if thought:item.update(reasoning=thought['text'],reasoningTruncated=bool(thought['truncated']))
                if thought:
                    import hashlib
                    translated=self.reasoning_translations.cached(item['id'],hashlib.sha256(thought['text'].encode()).hexdigest())
                    if translated:item.update(reasoningTranslation=translated['text'],reasoningTranslationModel=translated['model'])
        return {
            "roleId": role, "sessionId": session, "items": items, "empty": not items,
            "hasMore": has_more, "nextAfterOrdinal": page[-1]["ordinal"] if has_more and page else None,
        }

    def clear_conversation(self, args: dict[str, Any]) -> dict[str, Any]:
        role, session = self._conversation_identity(
            str(args.get("roleId") or ""), str(args.get("sessionId") or "")
        )
        cleared_at = utc_now()
        with closing(self.connect()) as database, database:
            cursor = database.execute(
                "UPDATE conversation_messages SET deleted_at=? WHERE role_id=? AND session_id=? AND deleted_at=''",
                (cleared_at, role, session),
            )
            cleared = cursor.rowcount
        return {"roleId": role, "sessionId": session, "cleared": cleared, "clearedAt": cleared_at}

    def upsert_schedule(self, args: dict[str, Any]) -> dict[str, Any]:
        title, due_at = str(args.get("title") or "").strip(), str(args.get("dueAt") or "").strip()
        if not title or not due_at:
            raise ValueError("schedule_title_and_due_required")
        datetime.fromisoformat(due_at.replace("Z", "+00:00"))
        item_id, now = str(args.get("id") or f"schedule-{uuid.uuid4().hex}"), utc_now()
        values = (
            item_id, str(args.get("roleId") or "shared"), title, str(args.get("note") or ""), due_at,
            max(0, int(args.get("leadMinutes") or 0)), str(args.get("status") or "upcoming"), "", now, now,
        )
        with closing(self.connect()) as database, database:
            database.execute(
                "INSERT INTO schedules VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET role_id=excluded.role_id,title=excluded.title,note=excluded.note,due_at=excluded.due_at,lead_minutes=excluded.lead_minutes,status=excluded.status,updated_at=excluded.updated_at",
                values,
            )
        return {"id": item_id, "roleId": values[1], "title": title, "dueAt": due_at, "status": values[6]}

    def list_schedules(self, role_id: str = "") -> list[dict[str, Any]]:
        sql, params = "SELECT * FROM schedules", []
        if role_id:
            sql += " WHERE role_id=?"
            params.append(role_id)
        with closing(self.connect()) as database, database:
            return [dict(row) for row in database.execute(sql + " ORDER BY due_at ASC LIMIT 100", params).fetchall()]

    @staticmethod
    def _clock_minutes(value: str) -> int:
        match = re.fullmatch(r"([01]\d|2[0-3]):([0-5]\d)", value)
        if not match:
            raise ValueError("proactive_clock_invalid")
        return int(match.group(1)) * 60 + int(match.group(2))

    def get_proactive_policy(self) -> dict[str, Any]:
        with closing(self.connect()) as database:
            row = database.execute("SELECT * FROM proactive_policy WHERE id='default'").fetchone()
        if row is None:
            # Recover a missing singleton conservatively; existing owner settings
            # are never overwritten, including after identity-bank restoration.
            with closing(self.connect()) as database,database:
                database.execute('INSERT OR IGNORE INTO proactive_policy VALUES(?,?,?,?,?,?,?,?,?,?)',('default','shira',0,'23:00','08:00',180,3,2,1440,utc_now()))
                row=database.execute("SELECT * FROM proactive_policy WHERE id='default'").fetchone()
        return {
            "roleId": row["role_id"],
            "enabled": bool(row["enabled"]),
            "quietStart": row["quiet_start"],
            "quietEnd": row["quiet_end"],
            "minimumIntervalMinutes": int(row["minimum_interval_minutes"]),
            "dailyCap": int(row["daily_cap"]),
            "unansweredLimit": int(row["unanswered_limit"]),
            "unansweredCooldownMinutes": int(row["unanswered_cooldown_minutes"]),
            "updatedAt": row["updated_at"],
        }

    def upsert_proactive_policy(self, args: dict[str, Any]) -> dict[str, Any]:
        current = self.get_proactive_policy()
        quiet_start = str(args.get("quietStart", current["quietStart"]))
        quiet_end = str(args.get("quietEnd", current["quietEnd"]))
        self._clock_minutes(quiet_start)
        self._clock_minutes(quiet_end)
        minimum_interval = max(180, min(1440, int(args.get("minimumIntervalMinutes", current["minimumIntervalMinutes"]))))
        daily_cap = max(1, min(8, int(args.get("dailyCap", current["dailyCap"]))))
        unanswered_limit = max(1, min(5, int(args.get("unansweredLimit", current["unansweredLimit"]))))
        unanswered_cooldown = max(180, min(10080, int(args.get("unansweredCooldownMinutes", current["unansweredCooldownMinutes"]))))
        updated_at = utc_now()
        with closing(self.connect()) as database, database:
            database.execute(
                """UPDATE proactive_policy SET role_id=?,enabled=?,quiet_start=?,quiet_end=?,
                   minimum_interval_minutes=?,daily_cap=?,unanswered_limit=?,
                   unanswered_cooldown_minutes=?,updated_at=? WHERE id='default'""",
                (
                    str(args.get("roleId") or current["roleId"]).strip() or "shira",
                    1 if args.get("enabled", current["enabled"]) else 0,
                    quiet_start,
                    quiet_end,
                    minimum_interval,
                    daily_cap,
                    unanswered_limit,
                    unanswered_cooldown,
                    updated_at,
                ),
            )
        return self.get_proactive_policy()

    def proactive_status(self) -> dict[str, Any]:
        policy = self.get_proactive_policy()
        with closing(self.connect()) as database:
            rows = database.execute(
                "SELECT decision,response_state,created_at FROM proactive_receipts ORDER BY created_at DESC LIMIT 100"
            ).fetchall()
        policy["receiptCount"] = len(rows)
        policy["sentCount"] = sum(row["decision"] == "allowed" for row in rows)
        policy["unansweredCount"] = sum(
            row["decision"] == "allowed" and row["response_state"] == "unanswered" for row in rows
        )
        policy["lastDecision"] = rows[0]["decision"] if rows else "none"
        policy["lastDecisionAt"] = rows[0]["created_at"] if rows else ""
        return policy

    def _record_proactive_decision(
        self,
        *,
        role_id: str,
        reason: str,
        decision: str,
        response_state: str,
        now: datetime,
        next_eligible_at: datetime | None = None,
    ) -> dict[str, Any]:
        receipt_id = f"proactive-{uuid.uuid4().hex}"
        created_at = now.isoformat()
        next_at = next_eligible_at.isoformat() if next_eligible_at else ""
        with closing(self.connect()) as database, database:
            database.execute(
                "INSERT INTO proactive_receipts VALUES(?,?,?,?,?,?,?)",
                (receipt_id, role_id, reason, decision, response_state, next_at, created_at),
            )
            if decision == "allowed":
                payload = json.dumps(
                    {"receiptId": receipt_id, "reason": reason, "policyDecision": decision},
                    ensure_ascii=False,
                )
                database.execute(
                    "INSERT INTO events(type,role_id,payload_json,created_at) VALUES('proactive_due',?,?,?)",
                    (role_id, payload, created_at),
                )
        return {
            "allowed": decision == "allowed",
            "reason": decision,
            "receiptId": receipt_id,
            "wakeAgent": decision == "allowed",
            "memoryAction": "none",
            "nextEligibleAt": next_at,
            "createdAt": created_at,
        }

    def evaluate_proactive(self, args: dict[str, Any]) -> dict[str, Any]:
        role_id = str(args.get("roleId") or "shared").strip() or "shared"
        reason = str(args.get("reason") or "scheduled").strip()[:80] or "scheduled"
        raw_now = str(args.get("now") or "").strip()
        now = datetime.fromisoformat(raw_now.replace("Z", "+00:00")) if raw_now else datetime.now().astimezone()
        if now.tzinfo is None:
            raise ValueError("proactive_time_requires_timezone")
        policy = self.get_proactive_policy()
        if not policy["enabled"]:
            return self._record_proactive_decision(
                role_id=role_id, reason=reason, decision="disabled", response_state="not_sent", now=now
            )

        start = self._clock_minutes(policy["quietStart"])
        end = self._clock_minutes(policy["quietEnd"])
        current = now.hour * 60 + now.minute
        quiet = start != end and (start <= current < end if start < end else current >= start or current < end)
        if quiet:
            next_day = now + timedelta(days=1) if current >= start and start > end else now
            next_at = next_day.replace(hour=end // 60, minute=end % 60, second=0, microsecond=0)
            return self._record_proactive_decision(
                role_id=role_id, reason=reason, decision="quiet_hours", response_state="not_sent", now=now, next_eligible_at=next_at
            )

        with closing(self.connect()) as database:
            rows = database.execute(
                """SELECT * FROM proactive_receipts
                   WHERE role_id=? AND decision='allowed' ORDER BY created_at DESC LIMIT 100""",
                (role_id,),
            ).fetchall()
        sent = [row for row in rows if datetime.fromisoformat(row["created_at"]).tzinfo is not None]
        sent_today = [row for row in sent if datetime.fromisoformat(row["created_at"]).astimezone(now.tzinfo).date() == now.date()]
        if len(sent_today) >= policy["dailyCap"]:
            next_at = (now + timedelta(days=1)).replace(hour=end // 60, minute=end % 60, second=0, microsecond=0)
            return self._record_proactive_decision(
                role_id=role_id, reason=reason, decision="daily_cap", response_state="not_sent", now=now, next_eligible_at=next_at
            )

        consecutive_unanswered = 0
        for row in sent:
            if row["response_state"] != "unanswered":
                break
            consecutive_unanswered += 1
        if consecutive_unanswered >= policy["unansweredLimit"] and sent:
            next_at = datetime.fromisoformat(sent[0]["created_at"]) + timedelta(minutes=policy["unansweredCooldownMinutes"])
            if now < next_at:
                return self._record_proactive_decision(
                    role_id=role_id, reason=reason, decision="unanswered_cooldown", response_state="not_sent", now=now, next_eligible_at=next_at
                )

        if sent:
            next_at = datetime.fromisoformat(sent[0]["created_at"]) + timedelta(minutes=policy["minimumIntervalMinutes"])
            if now < next_at:
                return self._record_proactive_decision(
                    role_id=role_id, reason=reason, decision="minimum_interval", response_state="not_sent", now=now, next_eligible_at=next_at
                )
        return self._record_proactive_decision(
            role_id=role_id, reason=reason, decision="allowed", response_state="unanswered", now=now
        )

    def acknowledge_proactive(self, role_id: str) -> dict[str, Any]:
        role_id = role_id.strip() or "shared"
        with closing(self.connect()) as database, database:
            row = database.execute(
                """SELECT id FROM proactive_receipts WHERE role_id=? AND decision='allowed'
                   AND response_state='unanswered' ORDER BY created_at DESC LIMIT 1""",
                (role_id,),
            ).fetchone()
            if row is None:
                return {"acknowledged": False, "roleId": role_id}
            database.execute(
                "UPDATE proactive_receipts SET response_state='answered' WHERE id=?",
                (row["id"],),
            )
        return {"acknowledged": True, "roleId": role_id, "receiptId": row["id"]}

    def execute_task(self, payload: dict[str, Any]) -> dict[str, Any]:
        task_id = str(payload.get("id") or f"task-{uuid.uuid4().hex}")
        role_id, requested = str(payload.get("roleId") or "shared"), str(payload.get("tool") or "")
        query = str(payload.get("query") or payload.get("input") or payload.get("title") or task_id)
        if requested in {"web_fetch", "web/local research"}:
            source_urls = [str(url) for url in payload.get("sourceUrls", [])] if isinstance(payload.get("sourceUrls"), list) else []
            tool, args = "web_fetch", {"query": query, "urls": source_urls}
        elif requested in {"memory", "memory_save", "typed memory draft"}:
            tool, args = "memory_save", {"roleId": role_id, "kind": "task_result", "content": payload.get("memory") or query, "source": f"task:{task_id}", "confidence": .82}
        elif requested in {"schedule", "schedule_list", "schedule helper"}:
            tool, args = "schedule_list", {"roleId": role_id}
        else:
            source_paths = [str(path) for path in payload.get("sourcePaths", [])] if isinstance(payload.get("sourcePaths"), list) else []
            tool, args = "knowledge_search", {"query": query, "limit": 8, "paths": source_paths}
        started = utc_now()
        safe_input = {key: payload[key] for key in (
            "id", "roleId", "title", "tool", "input", "query", "sourcePaths", "sourceUrls", "memory"
        ) if key in payload}
        history = TaskHistory(self.connect)
        history.start(task_id, role_id, str(payload.get("title") or task_id), tool, safe_input, started)
        output = self.registry.dispatch(tool, args)
        finished, status = utc_now(), "completed" if output.get("ok") else "failed"
        result = output.get("result") if isinstance(output.get("result"), dict) else {}
        sources = [
            f"{item['path']}:{item.get('line', 1)}" if item.get("path") else item.get("url", "")
            for item in result.get("items", []) if isinstance(item, dict) and (item.get("path") or item.get("url"))
        ]
        memory_saved = tool == "memory_save" and output.get("ok") is True
        if status == "completed" and not memory_saved:
            summary = str(payload.get("memory") or f"完成任务：{payload.get('title') or task_id}；工具：{tool}；来源：{'；'.join(sources[:6]) or '本地运行时'}")
            memory_saved = self.registry.dispatch("memory_save", {
                "roleId": role_id, "kind": "task_result", "content": summary,
                "source": f"task:{task_id}", "confidence": .86,
            }).get("ok") is True
        history.finish(task_id, status, output, finished)
        return {"id": task_id, "roleId": role_id, "tool": tool, "status": status, "output": output, "sources": sources, "memorySaved": memory_saved, "finishedAt": finished}

    def events_after(self, event_id: int = 0, limit: int = 50) -> list[dict[str, Any]]:
        with closing(self.connect()) as database, database:
            rows = database.execute("SELECT * FROM events WHERE id>? ORDER BY id ASC LIMIT ?", (max(0, event_id), max(1, min(200, limit)))).fetchall()
        return [{**dict(row), "payload": json.loads(row["payload_json"])} for row in rows]

    def _scheduler_loop(self) -> None:
        while not self._stop.wait(5):
            now = utc_now()
            with closing(self.connect()) as database, database:
                for row in database.execute("SELECT * FROM schedules WHERE status IN ('upcoming','snoozed') AND notified_at='' AND due_at<=? LIMIT 20", (now,)).fetchall():
                    payload = json.dumps({"scheduleId": row["id"], "title": row["title"], "note": row["note"], "dueAt": row["due_at"]}, ensure_ascii=False)
                    database.execute("INSERT INTO events(type,role_id,payload_json,created_at) VALUES('schedule_due',?,?,?)", (row["role_id"], payload, now))
                    database.execute("UPDATE schedules SET status='due',notified_at=?,updated_at=? WHERE id=?", (now, now, row["id"]))
            self._run_background_proactive_check()
            self.auto_moments.tick()
            self.moment_reactions.tick()
            self.character_events.tick()
            self.phone_groups.tick()
            self.role_workspace.tick()
            if self.backup_manager.dirty:
                try:
                    self.backup_manager.create_snapshot("mutation")
                except (OSError, RuntimeError, sqlite3.DatabaseError):
                    pass

    def _run_background_proactive_check(self) -> None:
        policy = self.get_proactive_policy()
        if not policy["enabled"]:
            return
        with closing(self.connect()) as db:
            state=db.execute('SELECT started FROM play_mode_state WHERE mode=?',(role_mode(policy['roleId']),)).fetchone()
            if state and not state[0]:return
        now = datetime.now().astimezone()
        with closing(self.connect()) as database:
            latest = database.execute(
                "SELECT * FROM proactive_receipts WHERE role_id=? ORDER BY created_at DESC LIMIT 1",
                (policy["roleId"],),
            ).fetchone()
        if latest:
            next_raw = str(latest["next_eligible_at"] or "")
            if next_raw and now < datetime.fromisoformat(next_raw).astimezone(now.tzinfo):
                return
            if latest["decision"] == "allowed":
                sent_at = datetime.fromisoformat(latest["created_at"]).astimezone(now.tzinfo)
                if now < sent_at + timedelta(minutes=policy["minimumIntervalMinutes"]):
                    return
        self.evaluate_proactive({"roleId": policy["roleId"], "reason": "background_scheduler", "now": now.isoformat()})

    def start(self) -> None:
        if self._scheduler and self._scheduler.is_alive():
            return
        self._stop.clear()
        self._scheduler = threading.Thread(target=self._scheduler_loop, name="hermes-agent-scheduler", daemon=True)
        self._scheduler.start()

    def create_runtime_backup(self, reason: str = "manual") -> dict[str, Any]:
        return self.backup_manager.create_snapshot(reason, force=True)

    def close(self) -> None:
        self._stop.set()
        self.reasoning_translations.close()
        self.role_workspace.close()
        self.remote_mcp.close()
        if self._scheduler:
            self._scheduler.join(timeout=2)
        if self.backup_manager.dirty:
            try:
                self.backup_manager.create_snapshot("shutdown", force=True)
            except (OSError, RuntimeError, sqlite3.DatabaseError):
                pass
