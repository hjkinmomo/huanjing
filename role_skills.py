"""Role-scoped method loading and explicitly requested fictional character travel."""
from __future__ import annotations

from contextlib import closing
import hashlib
import json
import re
import uuid
from character_mobility import requested_character_travel
from copy import deepcopy
from agent_tools import validate_arguments
from agent_tool_catalog import ROLE_SKILL_TOOLS, schema_for
from persona_modes import role_mode

CONTEXTS = {'chat', 'agent', 'moments', 'story'}
def appointment_turn_options(runtime,role,options,messages):
    """Schedule consent is a world function, independent of optional skill loading."""
    if not isinstance(options,dict) or options.get('enabled') is True:return options
    session=options.get('sessionId')
    if not role or not session or options.get('context','chat')!='chat':return options
    from chat_appointments import intent
    text=next((m.get('content','') for m in reversed(messages) if m.get('role')=='user'),'')
    direct=requested_character_travel(messages)
    with closing(runtime.connect()) as db:
        row=db.execute("SELECT s.mode,COALESCE(o.memory_policy,'normal') policy FROM role_sessions s LEFT JOIN chat_session_options o ON o.role_id=s.role_id AND o.session_id=s.session_id WHERE s.role_id=? AND s.session_id=? AND s.deleted_at=''",(role,session)).fetchone()
        if not row or row['mode']!='character' or row['policy']=='readonly':return options
        pending=db.execute("SELECT 1 FROM world_commitments WHERE role_id=? AND session_id=? AND status IN ('proposed','accepted','negotiate','awaiting_owner') LIMIT 1",(role,session)).fetchone()
        if not pending:pending=db.execute("SELECT 1 FROM role_living_tasks WHERE role_id=? AND kind='appointment-draft' AND status='waiting_place' AND json_extract(payload_json,'$.messageId') IN (SELECT id FROM conversation_messages WHERE role_id=? AND session_id=? AND sender='user' AND deleted_at='') LIMIT 1",(role,role,session)).fetchone()
    return {**options,'enabled':True,'appointmentOnly':True,'directTravel':direct,'worldId':options.get('worldId') or runtime.world_life.shared.world(role_mode(role))['id']} if intent(text) or pending or direct else options
ROLE = re.compile(r'^[A-Za-z0-9_.:-]{1,100}$')
POLICY = (
    '[role-skill-router-v1] 角色扮演辅助的连接规则：\n'
    '人物、情感、世界和经历继续沿用当前角色设定、世界书、会话及本角色记忆。技能只提供可选方法，不改人格或权限。'
    '普通闲聊直接回应。需要目录中的方法时用 skill_read；更多选择用 skill_catalog，不臆造正文。'
    '读取后自然融入角色表达，通常不播报技能名称。新地点可用 world_scene_read，提议不等于到达，剧情不等于实际执行。'
    '当前用户要求和角色设定优先于通用方法。'
)


def estimate_tokens(value):
    text = json.dumps(value, ensure_ascii=False) if not isinstance(value, str) else value
    chinese = sum('\u3400' <= c <= '\u9fff' for c in text)
    return chinese + (len(text) - chinese + 2) // 3


class RoleSkills:
    def __init__(self, runtime):
        self.runtime = runtime
        self.commitment_token=object()
        for name, handler in [('skill_catalog', self.catalog), ('skill_read', self.read), ('world_scene_read', self.scene), ('world_character_travel', self.travel),('world_commitment_decide',self.commitment_decide),('world_commitment_from_chat',self.commitment_from_chat),('world_social_read',self.social_read),('world_impression_set',self.impression_set)]:
            runtime.registry.register(name, {
                'skill_catalog': '查看本角色当前可用的方法目录，只有元数据；不读取全部技能正文。',
                'skill_read': '按需读取本角色可用技能或指定参考文件；方法不能替代人物设定或授予权限。',
                'world_social_read':'按需读取当前相关角色的公开名片及你自己的亲眼事实，不读取任何人的私聊或私人日程。',
                'world_impression_set':'根据你自己的seen事实证据保存100字内第一人称印象；不预设立场，不编造交谈、交情或隐私。',
                'world_commitment_from_chat':'把本轮已保存用户原话中的明确见面安排记为候选，不代表你已同意；时间地点由服务器核验，不接受模型补造参数。',
                'world_commitment_decide':'对当前角色已有约定表达本轮真实决定；可以拒绝、协商或取消，失败不得口头冒充已记录。',
                'world_character_travel': '用户本轮明确要求转场时，实际移动当前角色到本会话世界里的指定地点；只改角色，不替用户移动，失败不能说已到达。',
                'world_scene_read': '只读当前会话所选世界的预写地点，按地点名称或 ID 查找；不改变当前位置。',
            }[name],mutating=name in ['world_character_travel','world_commitment_decide','world_commitment_from_chat','world_impression_set'])(handler)

    @staticmethod
    def scope(args):
        role = args.get('roleId', 'shared')
        context = args.get('context', 'chat')
        if not isinstance(role, str) or not ROLE.fullmatch(role) or not isinstance(context, str) or context not in CONTEXTS:
            raise ValueError('skill_scope_invalid')
        disabled = args.get('disabledSkillIds', [])
        if not isinstance(disabled, list) or len(disabled) > 100 or any(not isinstance(v, str) or len(v) > 130 for v in disabled):
            raise ValueError('skill_bindings_invalid')
        return role, context, set(disabled)

    def entries(self, args):
        role, context, disabled = self.scope(args)
        # Revalidate files and review state on every read. A revoked or changed
        # user package cannot retain access through a catalog seen earlier.
        packages = self.runtime.list_extensions(refresh=True)['packages']
        result = []
        for package in packages:
            if package['type'] != 'skill' or not package['enabled'] or package['requiresReview']:
                continue
            for skill in package['skills']:
                identifier = package['id'] + '/' + skill['id']
                if (context not in skill['contexts'] or role_mode(role) not in skill['personaModes']
                        or (skill['roleIds'] and role not in skill['roleIds']) or identifier in disabled):
                    continue
                if args.get('includeRoleplay') is False and 'roleplay.expression' in package['capabilities']:
                    continue
                result.append((identifier, package, skill))
        return sorted(result, key=lambda row: row[0])

    @staticmethod
    def metadata(row):
        identifier, package, skill = row
        return {'id': identifier, 'name': skill['name'], 'description': skill['description'],
                'version': package['contentHash'], 'packageId': package['id'],
                'source': package['source'], 'references': list(skill['references'])}

    def catalog(self, args):
        rows = self.entries(args)
        query = str(args.get('query') or '').strip().casefold()
        items = [self.metadata(row) for row in rows if not query or query in (row[0] + row[2]['name'] + row[2]['description']).casefold()]
        offset, limit = args.get('offset', 0), args.get('limit', 12)
        if type(offset) is not int or type(limit) is not int or offset < 0 or not 1 <= limit <= 24:
            raise ValueError('skill_page_invalid')
        selected = items[offset:offset + limit]
        return {'roleId': self.scope(args)[0], 'context': args.get('context', 'chat'), 'items': selected,
                'total': len(items), 'hasMore': offset + len(selected) < len(items),
                'nextOffset': offset + len(selected), 'catalogVersion': hashlib.sha256(json.dumps(items, sort_keys=True).encode()).hexdigest()}

    def read(self, args):
        row = next((row for row in self.entries(args) if row[0] == args.get('id')), None)
        if row is None:
            raise PermissionError('skill_not_available_for_role')
        metadata = self.metadata(row)
        if args.get('expectedVersion') and args['expectedVersion'] != metadata['version']:
            raise ValueError('skill_version_changed_read_catalog_again')
        reference = args.get('reference')
        if reference is not None and reference not in row[2]['references']:
            raise PermissionError('skill_reference_not_declared')
        content = row[2]['instructions'] if reference is None else row[2]['references'][reference]
        return {**metadata, 'roleId': self.scope(args)[0], 'reference': reference, 'content': content,
                'contentHash': hashlib.sha256(content.encode()).hexdigest(),
                'kind': 'method-guidance-not-personality-or-memory', 'grantsPermissions': False}

    def scene(self, args):
        role, _, _ = self.scope(args)
        world = args.get('worldId')
        if not isinstance(world, str) or not world:
            raise PermissionError('scene_current_world_required')
        record = self.runtime.worldbook_for_role(role).scene_record(args)
        if record['available'] is False:
            raise PermissionError('scene_not_available')
        return {**record, 'changesCurrentLocation': False}

    def travel(self,args):
        role,context,_=self.scope(args)
        if context not in {'chat','agent'} or args.get('_travelAllowed') is not True:raise PermissionError('explicit_character_travel_required')
        session=args.get('sessionId');life=self.runtime.world_life.get({'roleId':role,'sessionId':session})
        if not life.get('enabled') or not life.get('valid'):raise ValueError('world_life_valid_world_required')
        metadata=self.runtime.role_workspace.session({'roleId':role,'sessionId':session})
        if metadata.get('memoryPolicy')=='readonly':raise PermissionError('readonly_character_travel_disabled')
        request=args.get('_travelRequestId')
        if not isinstance(request,str):raise PermissionError('character_travel_turn_required')
        result=self.runtime.world_life.character_travel({'roleId':role,'sessionId':session,'locationId':args['locationId'],'expectedRevision':life['revision'],'requestId':request,'method':args.get('method',life.get('transportMethod','walk'))})
        return {**result,'changesCurrentLocation':not bool(result.get('enRoute')),'departureStarted':bool(result.get('enRoute')),'changesUserLocation':False,'arrivalRule':'已出发不等于已到达，以 enRoute.dueAt 和后续账本为准。'}

    def social_read(self,args):return self.runtime.world_life.social.model.read(args)

    def impression_set(self,args):return self.runtime.world_life.social.model.write(args)

    def commitment_from_chat(self,args):
        if args.get('_commitmentToken') is not self.commitment_token:raise PermissionError('commitment_model_turn_required')
        return self.runtime.world_life.commitments.chat_source.propose(args)

    def commitment_decide(self,args):
        if args.get('_commitmentToken') is not self.commitment_token:raise PermissionError('commitment_model_turn_required')
        return self.runtime.world_life.commitments.model_decide(args)

    def prompt_context(self, role='shared', context='agent', include_roleplay=True, disabled=None):
        catalog = self.catalog({'roleId': role, 'context': context, 'includeRoleplay': include_roleplay,
                                'disabledSkillIds': disabled or [], 'limit': 12})
        # Body and reference contents are absent. Hashes remain available through
        # skill_catalog; the initial description is deliberately short.
        items = [{'id': item['id'], 'name': item['name'], 'description': item['description']} for item in catalog['items']]
        content = POLICY + '\n可用方法目录（只有描述）：\n' + '\n'.join(item['id'] + '：' + item['description'] for item in items) if items else ''
        if catalog['hasMore']:
            content += '\n目录还有更多方法，使用 skill_catalog 分页查看。'
        return {'text': content, 'skillIds': [item['id'] for item in catalog['items']],
                'packageIds': list(dict.fromkeys(item['packageId'] for item in catalog['items'])),
                'catalog': catalog, 'loading': 'on-demand', 'bytes': len(content.encode())}


class RoleSkillTurn:
    """At most three local method rounds, then a final reply with no more tools."""
    def __init__(self, runtime, role, options):
        self.runtime = runtime
        self.options = options if isinstance(options, dict) else {}
        if self.options.get('enabled') is not True:
            raise ValueError('skill_turn_not_enabled')
        self.scope = {'roleId': role, 'context': self.options.get('context', 'chat'),
                      'disabledSkillIds': self.options.get('disabledSkillIds', [])}
        runtime.role_skills.scope(self.scope)
        self.scope['worldId'] = self.options.get('worldId')
        self.scope['sessionId'] = self.options.get('sessionId')
        self.scope['_travelRequestId'] = 'character-'+uuid.uuid4().hex
        self.scope['_travelAllowed'] = False
        self.receipts = []
        self.rounds = 0

    def prepare(self, body):
        result = deepcopy(body)
        if result.get('tools'):
            raise ValueError('skill_turn_external_tools_forbidden')
        context = {'text':'','skillIds':[]} if self.options.get('appointmentOnly') else self.runtime.companion_features.context(self.scope)
        if context['text']:
            result['messages'].insert(0, {'role': 'system', 'content': '角色表达辅助；当前角色设定和用户本轮要求优先，不授予权限。\n' + context['text']})
        note=self.runtime.world_life.agenda.model_note(self.scope['roleId'],self.scope.get('sessionId')) if self.scope['context']=='chat' else ''
        if note:result['messages'].insert(0,{'role':'system','content':note})
        names = {'skill_catalog', 'skill_read'} if context['skillIds'] else set()
        if not self.options.get('appointmentOnly') and self.scope['context']=='chat' and self.scope.get('sessionId'):
            user=next((m.get('content') for m in reversed(body.get('messages',[])) if m.get('role')=='user'),None)
            social=self.runtime.world_life.social.model.grant(self.scope['roleId'],self.scope['sessionId'],user,self.options.get('sourceMessageId'))
            if social:
                self.scope.update(social['scope']);names.add('world_social_read')
                if social['canWrite']:names.add('world_impression_set')
                result['messages'].insert(0,{'role':'system','content':social['note']})
        if self.scope['worldId'] and (not self.options.get('appointmentOnly') or self.options.get('directTravel')):
            names.add('world_scene_read')
            if self.scope['sessionId'] and self.scope['context']=='chat' and requested_character_travel(body.get('messages',[])) and not self.runtime.world_life.rooms.pending_turn(self.scope['roleId'],self.scope['sessionId'],self.options.get('sourceMessageId')):
                metadata=self.runtime.world_life.scope({'roleId':self.scope['roleId'],'sessionId':self.scope['sessionId']})[3]
                if metadata.get('memoryPolicy')!='readonly' and (metadata.get('opening') or {}).get('world',{}).get('id')==self.scope['worldId']:
                    self.scope['_travelAllowed']=True;names.add('world_character_travel')
                    result['messages'].insert(0,{'role':'system','content':'用户明确提出转场时，若角色决定接受，先使用 world_scene_read 查地点 ID，再用 world_character_travel 实际移动自己。只能用本会话地点。回执 enRoute 表示正在途中，可说出发，不能说已到达；只有账本 enRoute 为空且实际位置是目的地才已抵达。交通方式可按自己的习惯选择 walk/bike/bus/taxi；失败应说明尚未移动。此工具不替用户移动。'})
        if self.scope.get('sessionId') and self.scope['context']=='chat':
            chat=self.runtime.world_life.commitments.chat_source.grant(self.scope['roleId'],self.scope['sessionId'],body.get('messages',[]),expected_id=self.options.get('sourceMessageId'))
            if chat:
                if chat.get('scope'):
                    self.scope.update(chat['scope']);self.scope['_commitmentToken']=self.runtime.role_skills.commitment_token;names.update(['world_commitment_from_chat','world_commitment_decide'])
                    result['messages'].insert(0,{'role':'system','content':'本轮用户原话有一个明确见面提议。若准备回应这份提议，先用 world_commitment_from_chat 保存候选，再在下一轮工具调用中用 world_commitment_decide 表达你自己的真实决定；用户提出不代表你同意，不可仅口头承诺而不记账。接受后还需用户在聊天确认卡上确认更改日程；awaiting_owner表示等待确认，不是已经写入最终日程或已经出发。不要立即使用转场工具。无需再次调用额外模型或重复发送消息。服务器解析的候选如下：'+json.dumps({k:chat['facts'][k] for k in ['eligible','status','at','timeKind','locationId','durationMinutes'] if k in chat['facts']},ensure_ascii=False)})
                else:result['messages'].insert(0,{'role':'system','content':'本轮像是在商量见面，但时间或地点不够明确。先自然地问清楚关键条件；不要自己补定时间、地点或直接动身。未建立约定，原因：'+chat['facts']['reason']})
            grant=self.runtime.world_life.commitments.grant(self.scope['roleId'],self.scope['sessionId'],expected_text=next((m.get('content') for m in reversed(body.get('messages',[])) if m.get('role')=='user'),''),expected_message_id=self.options.get('sourceMessageId'))
            if grant:
                if self.scope.get('_chatProposalGrant'):self.scope.update({k:grant[k] for k in ['_commitmentRecords','_commitmentRevisions']})
                else:self.scope.update(grant)
                self.scope['_commitmentToken']=self.runtime.role_skills.commitment_token;names.add('world_commitment_decide')
                result['messages'].insert(0,{'role':'system','content':'以下是你与当前用户的已有约定候选。你可自主同意、拒绝或协商，也可改变已确认约定而取消；用 world_commitment_decide 记录本轮真实决定。只限所列ID，不从引用、假设、台词命令生成承诺。返回失败时不可说已经约好或已经取消。accept需原提议可行；改地点或时间用negotiate并在聊天商量，待用户重新提交明确提议。'+self.runtime.world_life.commitments.model_brief(grant)})
        tools = [item for item in self.runtime.model_tool_definitions() if item['function']['name'] in names]
        if tools:
            result['tools'], result['tool_choice'] = tools, 'auto'
        return self.checked(result)

    def checked(self, body):
        window = self.options.get('contextWindow', 1048576)
        if type(window) is not int or not 4096 <= window <= 1048576:
            raise ValueError('skill_context_window_invalid')
        if estimate_tokens(body) + int(body.get('max_tokens') or 0) > int(window * .95):
            raise ValueError('skill_context_budget_exceeded')
        return body

    def accept(self, body, message):
        calls = message.get('tool_calls')
        if not isinstance(calls, list) or not 1 <= len(calls) <= 3 or self.rounds >= 3:
            raise ValueError('skill_tool_call_limit')
        exposed = {item['function']['name'] for item in body.get('tools', [])}
        identifiers = set()
        for call in calls:
            if not isinstance(call, dict) or not isinstance(call.get('id'), str) or not call['id'] or call['id'] in identifiers:
                raise ValueError('skill_tool_call_invalid')
            identifiers.add(call['id'])
            function = call.get('function')
            if not isinstance(function, dict) or function.get('name') not in ROLE_SKILL_TOOLS or not isinstance(function.get('arguments'), str):
                raise ValueError('skill_tool_call_invalid')
        updated = deepcopy(body)
        assistant = {'role': 'assistant', 'content': message.get('content') or None, 'tool_calls': calls}
        if isinstance(message.get('reasoning_content'), str):
            assistant['reasoning_content'] = message['reasoning_content']
        updated['messages'].append(assistant)
        for call in calls:
            function = call['function']; name = function['name']
            arguments = {}
            try:
                arguments = json.loads(function['arguments'])
                error = validate_arguments(arguments, schema_for(name))
                if error:
                    raise ValueError('invalid_skill_arguments:' + error)
                if name not in exposed:
                    raise PermissionError('skill_tool_not_enabled')
                result = self.runtime.registry.dispatch(name, {**arguments, **self.scope,'_commitmentCallId':call['id'],'_modelCallId':call['id']})
                if name=='world_commitment_from_chat' and result.get('ok'):
                    grant=self.runtime.world_life.commitments.grant(self.scope['roleId'],self.scope['sessionId'])
                    if grant:self.scope.update({k:grant[k] for k in ['_commitmentRecords','_commitmentRevisions']})
            except (ValueError, PermissionError) as error:
                result = {'ok': False, 'tool': name, 'error': str(error)}
            self.receipts.append({'tool': name, 'id': arguments.get('id', '') if isinstance(arguments, dict) else '',
                                  'ok': result.get('ok') is True})
            updated['messages'].append({'role': 'tool', 'tool_call_id': call['id'], 'content': json.dumps(result, ensure_ascii=False)})
        self.rounds += 1
        if self.rounds == 3:
            updated.pop('tools', None); updated.pop('tool_choice', None)
        return self.checked(updated)
