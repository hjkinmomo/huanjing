"""Central registration with schema-aware external dispatch, no optional dependencies."""
from typing import Any, Callable
from copy import deepcopy
from agent_tool_catalog import MODEL_SCHEMAS, MODEL_TOOL_NAMES, schema_for


def validate_arguments(value, schema, path="arguments", depth=0):
    """Validate the vocabulary used by this catalog (not a general schema engine)."""
    if depth > 12:
        return f"{path}:nesting_limit"
    expected = schema.get("type")
    types = {"object": dict, "array": list, "string": str, "integer": int, "boolean": bool}
    if expected in types and (not isinstance(value, types[expected]) or (expected == "integer" and isinstance(value, bool))):
        return f"{path}:expected_{expected}"
    if "enum" in schema and value not in schema["enum"]:
        return f"{path}:invalid_enum"
    if isinstance(value, dict):
        for field in schema.get("required", []):
            if field not in value:
                return f"{path}.{field}:required"
        properties = schema.get("properties", {})
        if schema.get("additionalProperties") is False and set(value) - set(properties):
            return f"{path}:unknown_fields"
        for field, field_schema in properties.items():
            if field in value:
                error = validate_arguments(value[field], field_schema, f"{path}.{field}", depth + 1)
                if error:
                    return error
    elif isinstance(value, list):
        if len(value) > schema.get("maxItems", 10000):
            return f"{path}:too_many_items"
        for index, item in enumerate(value):
            error = validate_arguments(item, schema.get("items", {}), f"{path}[{index}]", depth + 1)
            if error:
                return error
    elif isinstance(value, str):
        if not schema.get("minLength", 0) <= len(value) <= schema.get("maxLength", 1000000):
            return f"{path}:invalid_length"
    elif isinstance(value, int) and not isinstance(value, bool):
        if value < schema.get("minimum", value) or value > schema.get("maximum", value):
            return f"{path}:out_of_range"
    return ""

class ToolRegistry:
    """Hermes-style central registration and structured dispatch."""

    def __init__(self) -> None:
        self.tools: dict[str, dict[str, Any]] = {}

    def register(self, name: str, description: str, *, mutating: bool = False):
        def decorator(handler: Callable[[dict[str, Any]], dict[str, Any]]):
            if name in self.tools:
                raise ValueError(f"duplicate_tool:{name}")
            self.tools[name] = {"handler": handler, "description": description, "mutating": mutating,
                                "inputSchema": schema_for(name) if name in MODEL_SCHEMAS else None}
            return handler
        return decorator

    def definitions(self) -> list[dict[str, Any]]:
        return [
            {"name": name, "description": item["description"], "mutating": item["mutating"],
             **({"inputSchema": deepcopy(item["inputSchema"])} if item["inputSchema"] else {})}
            for name, item in self.tools.items()
        ]

    def model_definitions(self):
        return [{"type": "function", "function": {
            "name": name, "description": self.tools[name]["description"],
            "parameters": deepcopy(self.tools[name]["inputSchema"]),
        }} for name in MODEL_TOOL_NAMES]

    def dispatch(self, name: str, args: dict[str, Any]) -> dict[str, Any]:
        tool = self.tools.get(name)
        if not tool:
            return {"ok": False, "tool": name, "error": "unknown_tool"}
        if not isinstance(args, dict):
            return {"ok": False, "tool": name, "error": "tool_arguments_must_be_object"}
        try:
            # Reject removed-bank operations before any side effects, including imported state.
            def ordinary_only(value,field=''):
                if isinstance(value,dict):
                    for key,item in value.items():
                        if key.startswith('special.'):raise ValueError('persona_mode_not_available_in_public_edition')
                        ordinary_only(item,key)
                elif isinstance(value,list):
                    for item in value:ordinary_only(item,field)
                elif isinstance(value,str):
                    if field in {'mode','personaMode'} and value=='special' or field in {'roleId','role_id','roleIds','members','author_id'} and value.startswith('special.'):
                        raise ValueError('persona_mode_not_available_in_public_edition')
            ordinary_only(args)
            play=getattr(self,'play_guard',None)
            if play:play(name,args)
            handler=tool['handler'];guard=getattr(self,'identity_guard',None)
            result=guard(args,handler) if guard and 'expectedDataEpoch' in args else handler(args)
            return {"ok": True, "tool": name, "result": result}
        except (ValueError, PermissionError, FileNotFoundError) as error:
            return {"ok": False, "tool": name, "error": str(error)}
        except Exception as error:
            return {"ok": False, "tool": name, "error": "tool_execution_failed", "detail": type(error).__name__}
