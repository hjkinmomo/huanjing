"""Versioned data packs. Atomic reload, bounded validation, and retained retired IDs."""
from __future__ import annotations
from copy import deepcopy
from datetime import datetime, timezone
import hashlib, json, os, re, threading
from pathlib import Path
from city_names import canonical_city_value

ID = re.compile(r'^[a-z][a-z0-9_-]{0,63}$')
MAX_FILE = 524288

def token(value, at):
    if not isinstance(value,str) or not ID.fullmatch(value): raise ValueError(at+':invalid_id')
    return value
def text(value, at, limit=2000):
    if not isinstance(value,str) or not value.strip() or len(value)>limit: raise ValueError(at+':invalid_text')
    return value
def strings(value, at, count=64, limit=1000):
    if not isinstance(value,list) or len(value)>count: raise ValueError(at+':invalid_list')
    return [text(v,at,limit) for v in value]
def fields(value, allowed, at):
    if not isinstance(value,dict) or set(value)-set(allowed): raise ValueError(at+':unknown_fields')
def merge(a,b):
    result=deepcopy(a)
    for k,v in b.items():result[k]=merge(result[k],v) if isinstance(v,dict) and isinstance(result.get(k),dict) else deepcopy(v)
    return result
def validate_place(p):
    fields(p,{'id','name','aliases','description','objects','actions','exits','ambience','enabled','metadata'},'location')
    token(p.get('id'),'location.id');text(p.get('name'),'location.name',120)
    for key in ('description','ambience'):text(p.get(key),'location.'+key,2000)
    for key in ('aliases','objects','actions','exits'):strings(p.get(key),'location.'+key)
    for value in p['exits']:token(value,'location.exits')
    if 'enabled' in p and type(p['enabled']) is not bool:raise ValueError('location.enabled:invalid_boolean')
    metadata=p.get('metadata',{})
    if not isinstance(metadata,dict):raise ValueError('location.metadata:invalid_object')
    if metadata.get('access','public') not in ['public','staff','private']:raise ValueError('location.metadata:invalid_access')
    plan=metadata.get('plan')
    if plan is not None:
        import math
        if not isinstance(plan,dict) or set(plan)!={'x','y','w','h'} or any(type(v) not in (int,float) or not math.isfinite(v) for v in plan.values()):raise ValueError('location.plan:invalid_rectangle')
        if not (0<=plan['x']<100 and 0<=plan['y']<100 and 0<plan['w']<=100-plan['x'] and 0<plan['h']<=100-plan['y']):raise ValueError('location.plan:outside_room')
    if len(json.dumps(p.get('metadata',{}),ensure_ascii=False))>8192:raise ValueError('location.metadata:too_large')
def validate_world(w):
    fields(w,{'id','name','summary','rules','defaultLocation','locations','enabled','metadata'},'world')
    token(w.get('id'),'world.id');text(w.get('name'),'world.name',120);text(w.get('summary'),'world.summary')
    strings(w.get('rules'),'world.rules');token(w.get('defaultLocation'),'world.defaultLocation')
    if not isinstance(w.get('locations'),list) or not 1<=len(w['locations'])<=512:raise ValueError('world.locations:invalid_count')
    if 'enabled' in w and type(w['enabled']) is not bool:raise ValueError('world.enabled:invalid_boolean')
    ids=[]
    for p in w['locations']:validate_place(p);ids.append(p['id'])
    if len(set(ids))!=len(ids):raise ValueError('world.locations:duplicate_id')
    if w['defaultLocation'] not in ids:raise ValueError('world.defaultLocation:missing')
    if any(exit not in ids for p in w['locations'] for exit in p['exits']):raise ValueError('world.exits:missing_location')
    parents={p['id']:p.get('metadata',{}).get('parentId') for p in w['locations']}
    for id,parent in parents.items():
        if parent is not None and (not isinstance(parent,str) or parent not in ids or parent==id):raise ValueError('world.hierarchy:invalid_parent')
        seen={id};current=parent
        while current:
            if current in seen:raise ValueError('world.hierarchy:cycle')
            seen.add(current);current=parents[current]
    if len(json.dumps(w.get('metadata',{}),ensure_ascii=False))>8192:raise ValueError('world.metadata:too_large')
def validate_presentation(p):
    fields(p,{'narrationModes','narrationRules','stickers','sharedGuidance','reasoningLanguagePrompt','reveal'},'presentation')
    modes=p.get('narrationModes')
    if not isinstance(modes,list) or {m.get('id') for m in modes if isinstance(m,dict)}!={'off','scene','inner'} or len(modes)!=3:raise ValueError('presentation.narrationModes:keep_base_modes')
    for m in modes:
        fields(m,{'id','label','guidance'},'narrationMode');text(m.get('label'),'narrationMode.label',120);text(m.get('guidance'),'narrationMode.guidance',4000)
    strings(p.get('narrationRules'),'narrationRules',64,4000)
    if not isinstance(p.get('sharedGuidance'),str) or len(p['sharedGuidance'])>8000:raise ValueError('sharedGuidance:invalid_text')
    text(p.get('reasoningLanguagePrompt'),'reasoningLanguagePrompt',2000)
    reveal=p.get('reveal');fields(reveal,{'intervalMs','sceneCharacters','dialogueDelayMs'},'reveal')
    for k,low,high in [('intervalMs',16,200),('sceneCharacters',1,20),('dialogueDelayMs',0,3000)]:
        if type(reveal.get(k)) is not int or not low<=reveal[k]<=high:raise ValueError('reveal.'+k+':invalid_range')
    stickers=p.get('stickers');fields(stickers,{'moods','voices','rules'},'stickers')
    if not isinstance(stickers.get('moods'),dict) or set(stickers['moods'])!={'smile','comfort','thinking','surprised','shy','sleepy'}:raise ValueError('stickers.moods:keep_asset_ids')
    for m in stickers['moods'].values():
        fields(m,{'label','use'},'sticker');text(m.get('label'),'sticker.label',120);text(m.get('use'),'sticker.use',2000)
    if not isinstance(stickers.get('voices'),dict) or len(stickers['voices'])>128:raise ValueError('stickers.voices:invalid')
    for role,v in stickers['voices'].items():
        if not isinstance(role,str) or not re.fullmatch(r'[\w.:-]{1,80}',role):raise ValueError('stickers.voice:invalid_role')
        text(v,'stickers.voice',2000)
    strings(stickers.get('rules'),'stickers.rules',64,4000)

class WorldbookRuntime:
    def __init__(self, project_root, data_dir, mode='normal', common=None):
        from persona_modes import checked_mode
        self.common=common;self.mode=checked_mode(mode);self.prefix='special-' if self.mode=='special' else ''
        self.project=Path(project_root).resolve();self.root=(Path(data_dir)/'worldbooks').resolve()
        self.packs=self.root/'packs';self.packs.mkdir(parents=True,exist_ok=True)
        self.cache=self.root/'last-good.json';self.lock=threading.RLock();self.fingerprint=None;self.value=None;self.errors=[]
        if self.cache.is_file():
            try:
                cached=json.loads(self.cache.read_text('utf-8'));self._validate_snapshot(cached);self.value=cached
            except (ValueError,OSError,KeyError,TypeError):pass
        self.catalog(force=True)
    def _read(self,p):
        if p.is_symlink() or (p.parent==self.packs and not p.resolve().is_relative_to(self.packs.resolve())):raise ValueError('pack_path_outside_directory')
        if p.stat().st_size>MAX_FILE:raise ValueError('pack_file_too_large')
        return json.loads(p.read_text('utf-8-sig'))
    def _read_pack(self,p):
        value=canonical_city_value(self._pack(self._read(p)))
        if p.name!=value['id']+'.json':raise ValueError(p.name+':filename_must_match_pack_id')
        return value
    def _baseline(self):
        assets=self.project/'web/assets/experience'
        return {'worlds':self._read(assets/(self.prefix+'worldbook-catalog.json'))['worlds'], 'presentation':merge(self._read(assets/(self.prefix+'chat-presentation.json')),self._read(assets/(self.prefix+'runtime-defaults.json')))}
    def _visible_worlds(self,worlds):
        """Mode gates also apply to old caches and authored overrides of reserved IDs."""
        reserved=set()
        if self.mode=='normal':
            assets=self.project/'web/assets/experience'
            # Ordinary-only deployments need no special catalog. Stable legacy IDs
            # remain gated even if that optional file is absent during recovery.
            reserved={('urban',pid) for pid in ('moon-room','mirror-booth','private-lounge','rooftop')}
            special=assets/'special-worldbook-catalog.json'
            if special.is_file():
                ordinary={(w['id'],p['id']) for w in self._read(assets/'worldbook-catalog.json')['worlds'] for p in w['locations']}
                reserved|={(w['id'],p['id']) for w in self._read(special)['worlds'] for p in w['locations']}-ordinary
        def allowed(item):
            metadata=item.get('metadata',{})
            modes=metadata.get('personaModes') if isinstance(metadata,dict) else None
            return modes is None or isinstance(modes,list) and self.mode in modes
        result=[]
        for source in worlds:
            if not allowed(source):continue
            world=deepcopy(source)
            world['locations']=[p for p in world['locations'] if (world['id'],p['id']) not in reserved and allowed(p)]
            ids={p['id'] for p in world['locations']}
            if not ids:continue
            for place in world['locations']:place['exits']=[exit for exit in place['exits'] if exit in ids]
            if world['defaultLocation'] not in ids:
                world['defaultLocation']=next((p['id'] for p in world['locations'] if p.get('enabled',True) and p.get('available',True)),world['locations'][0]['id'])
            result.append(world)
        return canonical_city_value(result)
    def _validate_snapshot(self,s):
        if not isinstance(s,dict) or s.get('schemaVersion')!=1 or not isinstance(s.get('worlds'),list) or not 1<=len(s['worlds'])<=64:raise ValueError('catalog:invalid')
        if any(not isinstance(w,dict) or not isinstance(w.get('locations'),list) or any(not isinstance(p,dict) for p in w['locations']) for w in s['worlds']):raise ValueError('catalog:invalid_world')
        if len({w['id'] for w in s['worlds']})!=len(s['worlds']):raise ValueError('catalog:duplicate_world')
        for w in s['worlds']:
            if 'available' in w and type(w['available']) is not bool:raise ValueError('catalog.world.available:invalid_boolean')
            if any('available' in p and type(p['available']) is not bool for p in w['locations']):raise ValueError('catalog.location.available:invalid_boolean')
            clean={k:v for k,v in w.items() if k!='available'};clean['locations']=[{k:v for k,v in p.items() if k!='available'} for p in w['locations']];validate_world(clean)
        if sum(len(w['locations']) for w in s['worlds'])>1024:raise ValueError('catalog:too_many_locations')
        validate_presentation(s['presentation'])
    def _pack(self,p):
        fields(p,{'schemaVersion','id','label','priority','worlds','patches','presentation','metadata'},'pack')
        if p.get('schemaVersion')!=1:raise ValueError('pack:unsupported_schema_version')
        token(p.get('id'),'pack.id');text(p.get('label'),'pack.label',120)
        if type(p.get('priority',0)) is not int or not -100<=p.get('priority',0)<=100:raise ValueError('pack.priority:invalid')
        for key in ('worlds','patches'):
            if not isinstance(p.get(key,[]),list) or len(p.get(key,[]))>64:raise ValueError('pack.'+key+':invalid')
        for w in p.get('worlds',[]):validate_world(w)
        if not isinstance(p.get('presentation',{}),dict):raise ValueError('pack.presentation:invalid')
        if len(json.dumps(p,ensure_ascii=False).encode('utf-8'))>MAX_FILE:raise ValueError('pack_file_too_large')
        return p
    def _build(self,documents):
        base=self._baseline();worlds={w['id']:deepcopy(w) for w in base['worlds']};policy=base['presentation'];sources=[];owners=set()
        if self.mode=='special' and self.common:
            ordinary=next((w for w in self.common.catalog()['worlds'] if w['id']=='urban'),None)
            if ordinary and 'urban' in worlds:
                ordinary_places={p['id']:deepcopy(p) for p in ordinary['locations'] if p.get('available',True)}
                extras=[p for p in worlds['urban']['locations'] if p['id'] not in ordinary_places]
                for p in ordinary_places.values():p.pop('available',None)
                worlds['urban']['locations']=[*ordinary_places.values(),*extras]

        for p in sorted(documents,key=lambda p:(p.get('priority',0),p['id'])):
            self._pack(p);sources.append({'id':p['id'],'label':p['label'],'priority':p.get('priority',0),'digest':hashlib.sha256(json.dumps(p,ensure_ascii=False,sort_keys=True).encode()).hexdigest()})
            for w in p.get('worlds',[]):
                if w['id'] in worlds or w['id'] in owners:raise ValueError('pack.worlds:duplicate_id_use_patch')
                worlds[w['id']]=deepcopy(w);owners.add(w['id'])
            for patch in p.get('patches',[]):
                fields(patch,{'worldId','set','locations','removeLocations'},'patch');wid=token(patch.get('worldId'),'patch.worldId')
                if wid not in worlds:raise ValueError('patch.worldId:missing')
                change=patch.get('set',{});fields(change,{'name','summary','rules','defaultLocation','enabled','metadata'},'patch.set')
                w=worlds[wid];w.update(deepcopy(change));places={x['id']:x for x in w['locations']}
                if not isinstance(patch.get('locations',[]),list) or len(patch.get('locations',[]))>512:raise ValueError('patch.locations:invalid')
                for place in patch.get('locations',[]):
                    validate_place(place);copy=deepcopy(place);access=places.get(place['id'],{}).get('metadata',{}).get('access')
                    if access:copy.setdefault('metadata',{}).setdefault('access',access)
                    places[place['id']]=copy
                for removed in strings(patch.get('removeLocations',[]),'patch.removeLocations'):
                    if removed not in places:raise ValueError('patch.removeLocations:missing')
                    places[removed]['enabled']=False
                w['locations']=list(places.values())
            policy=merge(policy,p.get('presentation',{}))
        worlds={w['id']:w for w in self._visible_worlds(worlds.values())}
        for w in worlds.values():
            w['available']=w.get('enabled',True)
            for place in w['locations']:place['available']=w['available'] and place.get('enabled',True)
            if w['available'] and not next((p['available'] for p in w['locations'] if p['id']==w['defaultLocation']),False):raise ValueError('world.defaultLocation:disabled')
        # Removing a pack never makes existing sessions' stable IDs unreadable.
        for old in (self.value or {}).get('worlds',[]):
            if old['id'] not in worlds:
                retired=deepcopy(old);retired['available']=False
                for p in retired['locations']:p['available']=False
                worlds[old['id']]=retired
            else:
                current=worlds[old['id']];ids={p['id'] for p in current['locations']}
                for place in old['locations']:
                    if place['id'] not in ids:retired=deepcopy(place);retired['available']=False;current['locations'].append(retired)
        snapshot={'schemaVersion':1,'worlds':self._visible_worlds(worlds.values()),'presentation':policy,'packs':sources}
        self._validate_snapshot(snapshot)
        snapshot['version']=hashlib.sha256(json.dumps(snapshot,ensure_ascii=False,sort_keys=True).encode()).hexdigest()
        return snapshot
    def _files(self):
        files=sorted(self.packs.glob('*.json'))
        if len(files)>64 or sum(p.stat().st_size for p in files)>4*1024*1024:raise ValueError('pack_directory_too_large')
        return files
    def scene_record(self,args):
        world_id=token(args.get('worldId'),'scene.worldId')
        snapshot=self.catalog();world=next((w for w in snapshot['worlds'] if w['id']==world_id),None)
        if not world:raise ValueError('worldbook_world_missing')
        location=args.get('locationId');query=args.get('query')
        if location is not None:
            token(location,'scene.locationId');matches=[p for p in world['locations'] if p['id']==location]
        elif isinstance(query,str) and 0<len(query.strip())<=200:
            query=query.strip();matches=[p for p in world['locations'] if query in [p['name'],*p['aliases']]]
            if not matches:matches=[p for p in world['locations'] if any(len(key)>=2 and key in query for key in [p['name'],*p['aliases']])]
        else:raise ValueError('worldbook_scene_query_invalid')
        if len(matches)!=1:raise ValueError('worldbook_scene_missing' if not matches else 'worldbook_scene_ambiguous')
        place=matches[0]
        return {'personaMode':self.mode,'worldId':world_id,'worldName':world['name'],'version':snapshot['version'],
                'address':f'worldbook://{self.mode}/{world_id}/{place["id"]}','location':deepcopy(place),
                'available':world.get('available',True) and place.get('available',True),'source':'authored-worldbook'}

    def get_pack(self,args):
        name=token(args.get('id'),'pack.id');path=self.packs/(name+'.json')
        if not path.is_file():raise ValueError('worldbook_pack_missing')
        return canonical_city_value(self._pack(self._read(path)))
    def _atomic(self,path,data):
        path.parent.mkdir(parents=True,exist_ok=True);temp=path.with_suffix(path.suffix+'.tmp')
        temp.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8');os.replace(temp,path)
    def catalog(self,force=False):
        with self.lock:
            try:
                files=self._files();assets=self.project/'web/assets/experience'
                tracked=files+[assets/(self.prefix+n) for n in ('worldbook-catalog.json','chat-presentation.json','runtime-defaults.json')]
                if self.mode=='normal' and (assets/'special-worldbook-catalog.json').is_file():tracked.append(assets/'special-worldbook-catalog.json')
                if self.common:
                    tracked+=self.common._files()+[assets/n for n in ('worldbook-catalog.json','chat-presentation.json','runtime-defaults.json')]
                fingerprint=[(str(p),p.stat().st_size,p.stat().st_mtime_ns) for p in tracked]
                if force or fingerprint!=self.fingerprint:
                    snapshot=self._build([self._read_pack(p) for p in files])
                    if not self.value or snapshot['version']!=self.value['version']:self._atomic(self.cache,snapshot)
                    self.value=snapshot;self.errors=[];self.fingerprint=fingerprint
            except (ValueError,OSError,KeyError,TypeError) as error:
                self.errors=[str(error)[:500]]
                if not self.value:
                    try:self.value=self._build([]);self._atomic(self.cache,self.value)
                    except (ValueError,OSError,KeyError,TypeError):raise ValueError('worldbook_no_valid_catalog') from error
            snapshot=deepcopy(self.value)
            snapshot['worlds']=self._visible_worlds(snapshot['worlds'])
            return {**snapshot,'errors':list(self.errors),'personaMode':self.mode}
    def _check(self,args):
        current=self.catalog()
        if args.get('expectedVersion')!=current['version']:raise ValueError('worldbook_revision_conflict')
    def _backup(self,path):
        if path.exists():
            saved=self.root/'backups'/(path.stem+'-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')+'.json')
            saved.parent.mkdir(parents=True,exist_ok=True);saved.write_bytes(path.read_bytes())
    def _commit(self,path,pack,candidate):
        previous=path.read_bytes() if path.exists() else None;old=self.value
        self._backup(path)
        try:
            if pack is None:path.unlink()
            else:self._atomic(path,pack)
            self._atomic(self.cache,candidate)
        except OSError:
            if previous is None:
                if path.exists():path.unlink()
            else:path.write_bytes(previous)
            if old:self._atomic(self.cache,old)
            raise
        self.value=candidate;self.fingerprint=None
    def import_pack(self,args):
        with self.lock:
            self._check(args);p=self._pack(args.get('pack'));path=self.packs/(p['id']+'.json')
            if path.is_symlink() or not path.resolve().is_relative_to(self.packs.resolve()):raise ValueError('pack_path_outside_directory')
            files=[f for f in self._files() if f.name!=path.name]
            if sum(f.stat().st_size for f in files)+len(json.dumps(p,ensure_ascii=False,indent=2).encode('utf-8'))>4*1024*1024:raise ValueError('pack_directory_too_large')
            candidate=self._build([self._read_pack(f) for f in files]+[p])
            if len(files)>=64:raise ValueError('pack_directory_too_large')
            self._commit(path,p,candidate)
            return self.catalog(force=True)
    def remove_pack(self,args):
        with self.lock:
            self._check(args);name=token(args.get('id'),'pack.id');path=self.packs/(name+'.json')
            if not path.is_file() or path.is_symlink() or not path.resolve().is_relative_to(self.packs.resolve()):raise ValueError('worldbook_pack_missing')
            candidate=self._build([self._read_pack(f) for f in self._files() if f.name!=path.name])
            self._commit(path,None,candidate)
            return self.catalog(force=True)
