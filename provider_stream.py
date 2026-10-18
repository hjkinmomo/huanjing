"""Bounded, ephemeral chat streaming. Never stores credentials, prompts or partial replies."""
from __future__ import annotations
import json
import re
import socket
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from agent_runtime import DenyRedirectHandler, validate_public_https, validate_provider_url, MAX_PROVIDER_REQUEST_BYTES
from role_skills import RoleSkillTurn


def read_chat_stream(response, cancelled, on_text, on_usage=None, on_reasoning=None, on_finish=None, allow_length=False, on_tools=None):
    """SSE frames may contain comments, multiple data lines and usage-only chunks."""
    text, parts, total, finish = '', [], 0, None
    reasoning=''
    reasoning_truncated=False
    calls = {}
    while not cancelled.is_set():
        line = response.readline(65_537)
        if not line:
            raise ValueError('stream_interrupted')
        total += len(line)
        if len(line)>65_536 or total>2_097_152:
            raise ValueError('stream_response_too_large')
        line = line.decode('utf-8').rstrip('\r\n')
        if line.startswith('data:'):
            parts.append(line[5:].lstrip(' '))
        elif line == '' and parts:
            data='\n'.join(parts);parts=[]
            if data == '[DONE]':
                if calls:
                    if on_tools is None or finish != 'tool_calls':
                        raise ValueError('stream_incomplete_tool_call')
                    ordered = [calls[k] for k in sorted(calls)]
                    on_tools({'role': 'assistant', 'content': text or None, 'tool_calls': ordered,
                              **({'reasoning_content': reasoning} if reasoning else {})})
                    return None
                if finish not in ({'stop','length'} if allow_length else {'stop'}) or not text.strip():
                    raise ValueError('stream_incomplete_reply')
                if on_finish:on_finish(finish)
                return text
            payload=json.loads(data)
            if not isinstance(payload,dict) or payload.get('error'):
                raise ValueError('stream_provider_error')
            if on_usage and isinstance(payload.get('usage'),dict):on_usage(payload['usage'])
            choices=payload.get('choices',[])
            if not isinstance(choices,list):raise ValueError('stream_invalid_chunk')
            for choice in choices:
                if not isinstance(choice,dict):raise ValueError('stream_invalid_chunk')
                if choice.get('index',0)!=0:continue
                delta=choice.get('delta') or {}
                if not isinstance(delta,dict) or (delta.get('tool_calls') and on_tools is None):
                    raise ValueError('stream_tools_unsupported')
                fragments = delta.get('tool_calls')
                if fragments is not None:
                    if not isinstance(fragments, list):raise ValueError('stream_invalid_tool_call')
                    for fragment in fragments:
                        if not isinstance(fragment, dict) or type(fragment.get('index')) is not int or not 0 <= fragment['index'] < 3:
                            raise ValueError('stream_invalid_tool_call')
                        item = calls.setdefault(fragment['index'], {'id': '', 'type': 'function', 'function': {'name': '', 'arguments': ''}})
                        function = fragment.get('function') or {}
                        if not isinstance(function, dict) or fragment.get('type', 'function') != 'function':raise ValueError('stream_invalid_tool_call')
                        for source, target, key in [(fragment, item, 'id'), (function, item['function'], 'name'), (function, item['function'], 'arguments')]:
                            if key in source:
                                if not isinstance(source[key], str):raise ValueError('stream_invalid_tool_call')
                                target[key] += source[key]
                        if len(item['id']) > 256 or len(item['function']['name']) > 128 or len(item['function']['arguments']) > 64000:
                            raise ValueError('stream_tool_call_too_large')
                thought=delta.get('reasoning_content')
                if thought is not None:
                    if not isinstance(thought,str):raise ValueError('stream_invalid_chunk')
                    reasoning_truncated=reasoning_truncated or len(reasoning)+len(thought)>40000
                    reasoning=(reasoning+thought)[:40000]
                    if on_reasoning:on_reasoning(reasoning,reasoning_truncated)
                fragment=delta.get('content')
                if fragment is not None:
                    if not isinstance(fragment,str):raise ValueError('stream_invalid_chunk')
                    text+=fragment
                    if len(text.encode('utf-16-le'))//2>20_000:raise ValueError('stream_reply_too_large')
                    if not calls:on_text(text)
                reason=choice.get('finish_reason')
                if reason is not None:
                    finish=reason
                    if reason!='stop' and not (allow_length and reason=='length') and not (on_tools is not None and reason=='tool_calls'):
                        raise ValueError('stream_incomplete_reply')
    return None


class ChatStreams:
    def __init__(self,runtime,opener=None):
        self.runtime=runtime
        self.opener=opener or urllib.request.build_opener(DenyRedirectHandler())
        self.lock=threading.RLock();self.jobs={}

    def start(self,payload):
        provider=payload.get('provider') or {};body=payload.get('body') or {}
        role=str(payload.get('roleId') or '')
        identifier=str(payload.get('requestId') or uuid.uuid4().hex)
        if not re.fullmatch(r'[0-9a-f]{32}',identifier):raise ValueError('stream_request_id_invalid')
        if not re.fullmatch(r'[\w.:-]{1,80}',role):raise ValueError('stream_role_invalid')
        if payload.get('route')!='chat' or not isinstance(provider,dict) or not isinstance(body,dict):raise ValueError('stream_chat_only')
        endpoint=str(provider.get('endpoint') or '')
        if urllib.parse.urlparse(endpoint).hostname in {'127.0.0.1','::1'}:validate_provider_url(endpoint)
        else:validate_public_https(endpoint)
        if not urllib.parse.urlparse(endpoint).path.rstrip('/').endswith('/chat/completions'):raise ValueError('stream_endpoint_invalid')
        if not provider.get('apiKey') or not provider.get('model') or body.get('model')!=provider['model']:raise ValueError('provider_config_incomplete')
        messages=body.get('messages')
        if not isinstance(messages,list) or not 1<=len(messages)<=4096:raise ValueError('provider_chat_payload_invalid')
        self.runtime._validate_chat_messages(messages)
        if body.get('tools') or body.get('n',1)!=1:raise ValueError('stream_tools_unsupported')
        from current_character_context import add_current_character_context
        body=add_current_character_context(self.runtime,body,role,payload.get('roleSkills'))
        from role_skills import appointment_turn_options
        payload={**payload,'roleSkills':appointment_turn_options(self.runtime,role,payload.get('roleSkills'),body['messages'])}
        turn = None
        if isinstance(payload.get('roleSkills'), dict) and payload['roleSkills'].get('enabled') is True:
            turn = RoleSkillTurn(self.runtime, role, payload['roleSkills'])
            body = turn.prepare(body)
        body={**body,'stream':True}
        encoded=json.dumps(body,ensure_ascii=False).encode('utf-8')
        if len(encoded)>MAX_PROVIDER_REQUEST_BYTES:raise ValueError('provider_request_too_large')
        with self.lock:
            now=time.monotonic()
            self.jobs={k:j for k,j in self.jobs.items() if j['state']=='running' or now-j['updated']<300}
            prior=self.jobs.get(identifier)
            if prior:
                if prior['state']=='cancelled' and prior['roleId']==role:return self.status(identifier,role)
                raise ValueError('stream_duplicate_request')
            if len(self.jobs)>=32 or sum(j['state']=='running' for j in self.jobs.values())>=4:raise ValueError('stream_capacity_reached')
            if any(j['roleId']==role and j['state']=='running' for j in self.jobs.values()):raise ValueError('stream_role_busy')
            job={'id':identifier,'roleId':role,'state':'running','text':'','reasoning':'','reasoningTruncated':False,'error':'','httpStatus':None,'usage':{},'skillActivity':[],'updated':now,'cancelled':threading.Event(),'response':None}
            self.jobs[job['id']]=job
        threading.Thread(target=self._run,args=(job,dict(provider),encoded,turn),daemon=True).start()
        return self.status(job['id'],role)

    def status(self,identifier,role):
        with self.lock:
            job=self.jobs.get(identifier)
            if not job or job['roleId']!=role:raise ValueError('stream_not_found')
            return {'ok':True,**{k:job[k] for k in ('id','roleId','state','text','error','httpStatus')},'finishReason':job.get('finishReason',''),'usage':job.get('usage',{}),'reasoning':job.get('reasoning',''),'reasoningTruncated':job.get('reasoningTruncated',False),'skillActivity':job.get('skillActivity',[])}

    def cancel(self,identifier,role):
        with self.lock:
            job=self.jobs.get(identifier)
            if not job:
                if not re.fullmatch(r'[0-9a-f]{32}',identifier) or not re.fullmatch(r'[\w.:-]{1,80}',role) or len(self.jobs)>=32:raise ValueError('stream_not_found')
                event=threading.Event();event.set()
                job={'id':identifier,'roleId':role,'state':'cancelled','text':'','error':'','httpStatus':None,'updated':time.monotonic(),'cancelled':event,'response':None}
                self.jobs[identifier]=job
            if job['roleId']!=role:raise ValueError('stream_not_found')
            self._stop(job,'cancelled','')
        return self.status(identifier,role)

    def _stop(self,job,state,error):
        with self.lock:
            if job['state']!='running':return
            job.update(state=state,error=error,updated=time.monotonic());job['cancelled'].set()
            response=job['response']
        # Shutdown the socket without waiting on BufferedReader's cross-thread lock.
        try:response.fp.raw._sock.shutdown(socket.SHUT_RDWR)
        except (AttributeError,OSError):pass

    def _run(self,job,provider,encoded,turn=None):
        response=None
        deadline=threading.Timer(120,lambda:self._stop(job,'failed','stream_timeout'));deadline.daemon=True;deadline.start()
        try:
            body = json.loads(encoded)
            total_usage, prior_reasoning = {}, ''
            while not job['cancelled'].is_set():
                encoded = json.dumps(body, ensure_ascii=False).encode('utf-8')
                if len(encoded) > MAX_PROVIDER_REQUEST_BYTES:raise ValueError('provider_request_too_large')
                request=urllib.request.Request(provider['endpoint'],data=encoded,method='POST',headers={'Content-Type':'application/json','Authorization':f"Bearer {provider['apiKey']}",'Accept':'text/event-stream','User-Agent':'HermesProject5/1.0'})
                response=self.opener.open(request,timeout=max(2,min(120,int(provider.get('timeoutSeconds') or 90))))
                with self.lock:job['response']=response
                if job['cancelled'].is_set():return
                if response.geturl()!=provider['endpoint']:raise ValueError('provider_redirect_blocked')
                tool_messages, round_usage = [], {}
                def update(text):
                    with self.lock:
                        if job['state']=='running':job.update(text=text,updated=time.monotonic())
                def usage(value):
                    safe={k:v for k,v in value.items() if k in {'prompt_tokens','completion_tokens','total_tokens','prompt_cache_hit_tokens','prompt_cache_miss_tokens'} and type(v) is int and 0<=v<=10_000_000}
                    round_usage.update(safe)
                    with self.lock:job['usage']={**{k:total_usage.get(k,0)+round_usage.get(k,0) for k in total_usage.keys()|round_usage.keys()}, **({'context_prompt_tokens':round_usage['prompt_tokens']} if 'prompt_tokens' in round_usage else {})}
                def reasoning(value,truncated=False):
                    combined=prior_reasoning+value
                    with self.lock:
                        if job['state']=='running':job.update(reasoning=combined[:40000],reasoningTruncated=job.get('reasoningTruncated',False) or truncated or len(combined)>40000,updated=time.monotonic())
                def finish(reason):
                    with self.lock:job['finishReason']=reason
                structured=body.get('response_format',{}).get('type')=='json_object'
                content_type=response.headers.get('Content-Type','').lower()
                if 'text/event-stream' in content_type:
                    text=read_chat_stream(response,job['cancelled'],update,usage,reasoning,finish,allow_length=structured,
                                          on_tools=tool_messages.append if turn and body.get('tools') else None)
                elif 'json' in content_type:
                    # A provider ignoring stream still responds once per actual tool round.
                    raw=response.read(2_097_153)
                    if len(raw)>2_097_152:raise ValueError('stream_response_too_large')
                    payload=json.loads(raw.decode('utf-8'))
                    if isinstance(payload.get('usage'),dict):usage(payload['usage'])
                    reason=(payload.get('choices') or [{}])[0].get('finish_reason')
                    message=self.runtime._model_message(payload)
                    if message.get('tool_calls'):
                        if not turn or not body.get('tools'):raise ValueError('stream_tools_unsupported')
                        if reason not in {None,'tool_calls'}:raise ValueError('stream_incomplete_tool_call')
                        tool_messages.append(message);text=None
                    else:
                        if reason is not None and reason!='stop' and not (structured and reason=='length'):raise ValueError('stream_incomplete_reply')
                        text=message.get('content')
                        if not isinstance(text,str) or not text.strip() or len(text.encode('utf-16-le'))//2>20_000:raise ValueError('stream_incomplete_reply')
                        update(text);finish(reason or 'stop')
                    if isinstance(message.get('reasoning_content'),str):reasoning(message['reasoning_content'])
                else:raise ValueError('stream_content_type_invalid')
                response.close();response=None
                with self.lock:job['response']=None
                if job['cancelled'].is_set():return
                if tool_messages:
                    update('')
                    body=turn.accept(body,tool_messages[0])
                    with self.lock:job['skillActivity']=list(turn.receipts)
                    prior_reasoning=job['reasoning']+'\n' if job['reasoning'] else ''
                    total_usage={k:total_usage.get(k,0)+round_usage.get(k,0) for k in total_usage.keys()|round_usage.keys()}
                    continue
                with self.lock:
                    if job['state']=='running':job.update(text=text,state='complete',updated=time.monotonic())
                break
        except urllib.error.HTTPError as error:
            with self.lock:
                if job['state']=='running':job.update(state='failed',error='stream_provider_http_error',httpStatus=int(error.code),updated=time.monotonic())
        except Exception as error:
            with self.lock:
                if job['state']=='running':job.update(state='failed',error='stream_timeout' if isinstance(error,TimeoutError) else str(error) if isinstance(error,ValueError) else 'stream_connection_failed',updated=time.monotonic())
        finally:
            deadline.cancel()
            if response is not None:response.close()
            with self.lock:job['response']=None
            # provider and encoded exist only on this worker, never in status or persisted records.

    def close(self):
        with self.lock:jobs=list(self.jobs.values())
        for job in jobs:self._stop(job,'cancelled','')
