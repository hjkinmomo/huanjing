"""Shared, explicit schemas for model and interoperability boundaries."""
from copy import deepcopy

MODEL_SCHEMAS = {'conversation_search': {'type':'object','properties':{'query':{'type':'string','minLength':1,'maxLength':200},'limit':{'type':'integer','minimum':1,'maximum':30}},'required':['query']}, 'knowledge_search': {'type': 'object',
                      'properties': {'query': {'type': 'string'}, 'limit': {'type': 'integer'}},
                      'required': ['query']},
 'memory_search': {'type': 'object',
                   'properties': {'query': {'type': 'string'}, 'limit': {'type': 'integer'}},
                   'required': ['query']},
 'schedule_list': {'type': 'object', 'properties': {}},
 'office_workspace_inventory': {'type': 'object',
                                'properties': {'limit': {'type': 'integer',
                                                         'minimum': 1,
                                                         'maximum': 100}}},
 'action_propose': {'type': 'object',
                    'properties': {'origin': {'type': 'string',
                                              'enum': ['user_request', 'character_initiative'],
                                              'description': 'Use character_initiative for each '
                                                             'unrequested extra; approval is '
                                                             'always required.'},
                                   'actionType': {'type': 'string',
                                                  'enum': ['office_create_document',
                                                           'office_create_spreadsheet',
                                                           'office_create_presentation',
                                                           'screen_capture',
                                                           'read_text_file',
                                                           'open_url',
                                                           'open_path',
                                                           'write_text_file',
                                                           'mouse_move',
                                                           'mouse_click',
                                                           'type_text',
                                                           'key_press',
                                                           'run_diagnostic']},
                                   'summary': {'type': 'string'},
                                   'reason': {'type': 'string'},
                                   'args': {'type': 'object'}},
                    'required': ['actionType', 'summary', 'reason', 'args']},
 'action_proposal_list': {'type': 'object',
                          'properties': {'status': {'type': 'string',
                                                    'enum': ['pending',
                                                             'executing',
                                                             'denied',
                                                             'executed',
                                                             'failed',
                                                             'expired']},
                                         'limit': {'type': 'integer',
                                                   'minimum': 1,
                                                   'maximum': 50}}},
 'web_fetch': {'type': 'object',
               'properties': {'query': {'type': 'string'},
                              'urls': {'type': 'array', 'items': {'type': 'string'}}},
               'required': ['urls']},
 'web_search': {'type': 'object',
                'properties': {'query': {'type': 'string'},
                               'limit': {'type': 'integer', 'minimum': 1, 'maximum': 10}},
                'required': ['query']}}

WORK_ITEM_TOOLS = frozenset({"work_item_get", "work_item_event_list", "work_item_source_list", "work_item_artifact_list"})
MCP_MODEL_TOOLS = frozenset({"mcp_tool_list", "mcp_tool_propose"})
MODEL_SCHEMAS["mcp_tool_list"] = {"type": "object", "properties": {
    "serverId": {"type": "string", "minLength": 1, "maxLength": 80}}}
MODEL_SCHEMAS["mcp_tool_propose"] = {"type": "object", "properties": {
    "serverId": {"type": "string", "minLength": 1, "maxLength": 80},
    "toolName": {"type": "string", "minLength": 1, "maxLength": 128},
    "arguments": {"type": "object"}, "summary": {"type": "string", "minLength": 1, "maxLength": 240},
    "reason": {"type": "string", "minLength": 1, "maxLength": 1000}},
    "required": ["serverId", "toolName", "arguments", "summary", "reason"]}
for name in sorted(WORK_ITEM_TOOLS):
    key = "id" if name in {"work_item_get", "work_item_event_list"} else "workItemId"
    properties = {key: {"type": "string", "minLength": 1, "maxLength": 128}}
    if name != "work_item_get":
        properties["limit"] = {"type": "integer", "minimum": 1, "maximum": 100}
        if name == "work_item_event_list":
            properties["afterId"] = {"type": "integer", "minimum": 0}
        else:
            properties.update({"afterCreatedAt": {"type": "string"}, "afterId": {"type": "string"}})
    MODEL_SCHEMAS[name] = {"type": "object", "properties": properties, "required": [key]}
MODEL_SCHEMAS["memory_conflict_list"] = {"type": "object", "properties": {
    "status": {"type": "string", "enum": ["resolved", "reopened"]},
    "limit": {"type": "integer", "minimum": 1, "maximum": 50}}}
ROLE_SKILL_TOOLS = frozenset({'skill_catalog', 'skill_read', 'world_scene_read', 'world_character_travel','world_commitment_decide','world_commitment_from_chat','world_social_read','world_impression_set'})
MODEL_SCHEMAS['skill_catalog'] = {'type': 'object', 'properties': {
    'query': {'type': 'string', 'maxLength': 200},
    'offset': {'type': 'integer', 'minimum': 0, 'maximum': 1200},
    'limit': {'type': 'integer', 'minimum': 1, 'maximum': 24}}}
MODEL_SCHEMAS['skill_read'] = {'type': 'object', 'properties': {
    'id': {'type': 'string', 'minLength': 3, 'maxLength': 130},
    'reference': {'type': 'string', 'minLength': 1, 'maxLength': 180},
    'expectedVersion': {'type': 'string', 'minLength': 64, 'maxLength': 64}}, 'required': ['id']}
MODEL_SCHEMAS['world_scene_read'] = {'type': 'object', 'properties': {
    'locationId': {'type': 'string', 'minLength': 1, 'maxLength': 100},
    'query': {'type': 'string', 'minLength': 1, 'maxLength': 200}}}
MODEL_SCHEMAS['world_character_travel'] = {'type':'object','properties':{'locationId':{'type':'string','minLength':1,'maxLength':100},'method':{'type':'string','enum':['walk','bike','bus','taxi']}},'required':['locationId']}
MODEL_SCHEMAS['world_commitment_decide']={'type':'object','properties':{'id':{'type':'string','maxLength':100},'action':{'type':'string','enum':['accept','decline','negotiate','cancel']},'reason':{'type':'string','maxLength':800},'method':{'type':'string','enum':['walk','bike','bus','taxi']}},'required':['id','action','reason']}
MODEL_SCHEMAS['world_commitment_from_chat']={'type':'object','properties':{}}
MODEL_SCHEMAS['world_social_read']={'type':'object','properties':{'subjectId':{'type':'string','maxLength':80}},'required':['subjectId']}
MODEL_SCHEMAS['world_impression_set']={'type':'object','properties':{'subjectId':{'type':'string','maxLength':80},'text':{'type':'string','maxLength':100},'evidenceIds':{'type':'array','minItems':1,'maxItems':3,'items':{'type':'string','maxLength':100}}},'required':['subjectId','text','evidenceIds']}
for schema in MODEL_SCHEMAS.values():
    schema["additionalProperties"] = False
    for prop in schema["properties"].values():
        if prop.get("type") == "string":
            prop.setdefault("maxLength", 12000)
        if prop.get("type") == "integer":
            prop.setdefault("minimum", 1)
            prop.setdefault("maximum", 100)
        if prop.get("type") == "array":
            prop.setdefault("maxItems", 16)
            prop["items"].setdefault("maxLength", 2048)
MODEL_TOOL_NAMES = tuple(MODEL_SCHEMAS)

def schema_for(name):
    return deepcopy(MODEL_SCHEMAS[name])
