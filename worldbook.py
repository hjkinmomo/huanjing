"""Authored, session-scoped fictional setting data."""
import json
from pathlib import Path
def worlds(store=None):
    if store is not None:return store.catalog()['worlds']
    return json.loads((Path(__file__).parent/'web/assets/experience/worldbook-catalog.json').read_text('utf-8'))['worlds']
def normalize_world(value,store=None):
    if value is None:return None
    if not isinstance(value,dict) or set(value)-{'id','location'}:raise ValueError('chat_world_invalid')
    world=next((w for w in worlds(store) if w['id']==value.get('id')),None)
    if not world or not any(p['id']==value.get('location') for p in world['locations']):raise ValueError('chat_world_invalid')
    return {'id':world['id'],'location':value['location']}
def seed_scene(opening,store=None):
    binding=(opening or {}).get('world')
    if not binding:return None
    binding=normalize_world(binding,store);world=next(w for w in worlds(store) if w['id']==binding['id'])
    place=next(p for p in world['locations'] if p['id']==binding['location'])
    return {'location':place['name'],'setting':place['description'],'activity':'','outfit':'','mood':''}
