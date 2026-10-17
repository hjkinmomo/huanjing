"""Pure location hierarchy, shared by channels and deterministic schedules."""
import hashlib
def location_path(places,pid):
 path=[];seen=set()
 while pid in places and pid not in seen:
  seen.add(pid);p=places[pid];path.insert(0,p);pid=p.get('metadata',{}).get('parentId')
 return path
def scene_container(places,pid):
 path=location_path(places,pid)
 if not path:return None
 marked=[p for p in path if p.get('metadata',{}).get('planScope') is True or p.get('metadata',{}).get('kind')=='home' or p['id']=='home']
 if marked:return marked[-1]['id']
 if any(p.get('metadata',{}).get('parentId')==pid for p in places.values()):return pid
 return path[-2]['id'] if len(path)>1 else pid
def location_accessible(places,pid):
 return pid in places and all(not p.get('metadata',{}).get('locked') and p.get('enabled',True) and p.get('available',True) for p in location_path(places,pid))

def location_label(places,pid):return ' / '.join(p['name'] for p in location_path(places,pid))
def schedule_area(places,pid,actor,segment):
 # Exact authored leaves stay exact. Container schedules pick one leaf per slot/day.
 seen=set()
 while pid in places and pid not in seen:
  seen.add(pid);children=sorted([p for p in places.values() if p.get('metadata',{}).get('parentId')==pid and p.get('available',True) and p.get('enabled',True) and not p.get('metadata',{}).get('locked')],key=lambda p:p['id'])
  if not children:break
  # Don't allocate a venue visitor into someone else's private household.
  public=[p for p in children if p.get('metadata',{}).get('planScope') is not True and p.get('metadata',{}).get('kind')!='home' and p['id']!='home']
  public=[p for p in public if p.get('metadata',{}).get('access','public')=='public']
  if public:children=public
  elif any(p.get('metadata',{}).get('access') in ['staff','private'] for p in children):break
  elif not (places[pid].get('metadata',{}).get('planScope') or pid=='home'):break
  index=int(hashlib.sha256((actor+'|'+segment+'|'+pid).encode()).hexdigest()[:8],16)%len(children);pid=children[index]['id']
 return pid

def arrival_area(places,pid,actor):
 """Resolve a venue to a stable accessible public room; exact rooms stay exact.

 No clock or random redraw is involved. The returned ID is persisted as the
 actual position, rather than guessing a marker coordinate in the browser.
 """
 return schedule_area(places,pid,actor,'arrival:'+str(pid))
