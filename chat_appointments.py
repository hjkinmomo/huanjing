"""Conservative, pure extraction of explicit fictional appointment candidates.

No consent inference, model calls or writes. Unclear times/places stay dialogue.
The caller must pin the actual latest saved user message and its world clock.
"""
from datetime import datetime,timedelta,timezone
import re,unicodedata
from scene_locations import location_path,location_accessible

NUM=r'[0-9零〇一二两三四五六七八九十]+'
def number(text):
 if text.isdigit():return int(text) if len(text)<=4 else -1
 values={c:i for i,c in enumerate('零一二三四五六七八九')};values.update(〇=0,两=2)
 if text in values:return values[text]
 if text.count('十')==1:
  a,b=text.split('十')
  if (not a or a in values) and (not b or b in values):return (values.get(a,1))*10+values.get(b,0)
 return -1
def plain(text):
 if not isinstance(text,str) or not 1<=len(text)<=12000:return ''
 text=unicodedata.normalize('NFKC',text)
 # Do not stitch fragments across a quote into an actionable sentence.
 text=re.sub(r'```[\s\S]*?```|`[^`]*`|“[^”]*”|「[^」]*」|『[^』]*』|"[^"]*"|\x27[^\x27]*\x27|(?m:^\s*>[^\n]*)',' ',text)
 if any(c in text for c in ['`','“','”','「','」','『','』','"']):return ''
 return re.sub(r'\s+',' ',text).strip()
def intent(text):
 value=plain(text)
 if not value:return ''
 checked=value.replace('能不能','是否能')
 if any(w in checked for w in ['如果','假如','要是','比如','举例','假设','假定','有空的话','引用','台词','小说','演示','复述','转述','他说','她说','这句话','这段话','改写','翻译','写一句','不能说','别说','不要','别来','别去','不用来','不用去','不许','不想','不约','取消','别约','不会去','不去了','不能来','不能去']):return ''
 if re.search(r'别.{0,3}(?:去|来|约)|不(?:会|想|打算|准备)?(?:去|来|见面|赴约)',checked):return ''
 if not re.search(r'你|我们|咱们|一起|陪我|见面|碰头|会合',value):return ''
 if not re.search(r'来|去|见面|在.{1,35}见|(?:我们|咱们).{0,60}见[。！？吧]?\s*$|碰头|会合|集合|陪|一起.{0,8}(?:吃|喝|散步|看|逛|聊)',value):return ''
 if not re.search(r'明天|后天|今天|今晚|今早|今夜|周|星期|月.+[日号]|点|时|\d:\d|分钟后|小时后',value):return ''
 return value
def timed_intent(text):return bool(re.search(r'今天|明天|后天|今晚|今早|周|星期|月.+[日号]|下午|晚上|\d[:：]\d|'+NUM+r'[点时]|小时后|分钟后|稍后|晚点|待会|一会儿',plain(text)))

def time_kind(text,start,end):
 tail=text[end:end+14];depart=re.search(r'出发|动身|启程',tail);arrival=re.search(r'到|见|抵达|碰头|会合|集合',tail)
 if arrival and (not depart or arrival.start()<depart.start()):return 'arrival'
 if depart:return 'departure'
 prefix=text[max(0,start-40):start]
 prefix=re.sub(r'今天|明天|后天|今晚|今早|(?:下|本|这)?(?:周|星期)[一二三四五六日天]|(?:新历)?\d+年|'+NUM+r'月'+NUM+r'[日号]','',prefix)
 return 'departure' if re.search(r'(?:出发|动身|启程)(?:时间|时刻)?\s*(?:是|定在|约在|为|[:：])?\s*$',prefix) else 'arrival'

def when(text,anchor,offset):
 """Return explicit UTC time and semantics, or a clarification reason."""
 anchor=anchor.astimezone(timezone.utc);local=anchor+timedelta(minutes=offset)
 text=text.replace('明早','明天早上').replace('明晚','明天晚上').replace('明晨','明天早上')
 if any(w in text for w in ['下下周','下下星期','大后天','昨天','前天','昨晚','上周','上星期','下个月','下月','月底','月初','明年','后年','左右','大概','差不多']):return None,'time_ambiguous'
 relative=re.findall(r'(?:(半)|('+NUM+r'))\s*个?\s*(小时|分钟)后',text)
 clocks=list(re.finditer(r'(?:(凌晨|早上|早晨|上午|中午|下午|傍晚|晚上|夜里|今晚|今早))?\s*('+NUM+r')\s*(?:[:：](\d{2})|[点时](?:(半|一刻|三刻)|\s*('+NUM+r')\s*分?)?)',text))
 if relative:
  if len(relative)!=1 or clocks or re.search(r'明天|后天|周|星期|月.+[日号]',text):return None,'time_ambiguous'
  half,n,unit=relative[0];minutes=30 if half and unit=='小时' else -1 if half else number(n)*(60 if unit=='小时' else 1)
  if not 1<=minutes<=7*1440:return None,'time_invalid'
  span=re.search(r'(?:(半)|('+NUM+r'))\s*个?\s*(小时|分钟)后',text)
  return {'at':(anchor+timedelta(minutes=minutes)).isoformat(),'timeKind':time_kind(text,span.start(),span.end())},''
 if len(clocks)!=1:return None,'time_missing' if not clocks else 'time_ambiguous'
 match=clocks[0];part,h,colon,fraction,mins=match.groups();hour=number(h);minute=int(colon) if colon else {'半':30,'一刻':15,'三刻':45}.get(fraction,number(mins) if mins else 0)
 if re.match(r'前|之前|之后|以后|多|上下',text[match.end():]) or re.search(r'差(?:'+NUM+r'|一刻|半)|不到|不早于|不晚于|最晚|最早',text):return None,'time_ambiguous'
 if not 0<=hour<=23 or not 0<=minute<=59:return None,'time_invalid'
 if not part:
  if re.search(r'今晚|今夜',text):part='晚上'
  elif '今早' in text:part='早上'
 # A bare 3 o'clock is ambiguous; 15:00 or 下午三点 is explicit.
 if not part and 1<=hour<=12 and not (colon and (h.startswith('0') or hour==12)):return None,'daypart_missing'
 if part in ['下午','傍晚','晚上','夜里','今晚']:
  if hour in [0,12]:return None,'time_ambiguous'
  if 1<=hour<12:hour+=12
 elif part=='中午':
  if 1<=hour<=2:hour+=12
  elif hour not in [11,12]:return None,'time_ambiguous'
 elif part and hour>12:return None,'time_ambiguous'
 if part in ['凌晨','早上','早晨'] and hour==12:return None,'time_ambiguous'
 dates=re.findall(r'(?:(?:新历)?(\d{1,4})年)?('+NUM+r')月('+NUM+r')[日号]',text);weekdays=re.findall(r'(下周|本周|这周|周|下星期|本星期|星期)([一二三四五六日天])',text)
 if (re.search(r'周|星期',text) and not weekdays) or ('年' in text and not dates) or re.search(r'\d[/-]\d',text):return None,'date_ambiguous'
 days=[w for w in ['今天','明天','后天'] if w in text]
 if len(dates)+len(weekdays)+len(days)>1:return None,'date_ambiguous'
 target=local
 try:
  if dates:
   y,m,d=dates[0];year=(int(y)+1700 if int(y)<1000 else -1) if y else local.year;target=local.replace(year=year,month=number(m),day=number(d))
  elif weekdays:
   prefix,day=weekdays[0];weekday='一二三四五六日'.find(day.replace('天','日'));delta=weekday-local.weekday()
   if prefix.startswith('下'):delta+=7
   elif delta<0:
    if prefix.startswith(('本','这')):return None,'time_outside_window'
    delta+=7
   target=local+timedelta(days=delta)
  elif days:target=local+timedelta(days={'今天':0,'明天':1,'后天':2}[days[0]])
  target=target.replace(hour=hour,minute=minute,second=0,microsecond=0)-timedelta(minutes=offset)
 except (ValueError,OverflowError):return None,'time_invalid'
 if not anchor<target<=anchor+timedelta(days=7):return None,'time_outside_window'
 return {'at':target.isoformat(),'timeKind':time_kind(text,match.start(),match.end())},''

def destination(text,state,places):
 matches=[]
 for pid,p in places.items():
  if not location_accessible(places,pid):continue
  names=[p['name'],*p.get('aliases',[])]
  length=max((len(n) for n in names if isinstance(n,str) and len(n)>=2 and n in text),default=0)
  if length:matches.append((pid,length))
 if matches:
  longest=max(n for _,n in matches);ids=[pid for pid,n in matches if n==longest]
  # Prefer an exact detailed room over its ancestor when both share an alias.
  leaves=[pid for pid in ids if not any(pid in [a['id'] for a in location_path(places,other)[:-1]] for other in ids if other!=pid)]
  return (leaves[0],'') if len(leaves)==1 else (None,'place_ambiguous')
 for phrase,pid in [('你家',state.get('homeLocation')),('我家','home'),('我这里',state.get('userLocation')),('我这儿',state.get('userLocation')),('我身边',state.get('userLocation')),('找我',state.get('userLocation')),('你那里',state.get('roleLocation')),('你那儿',state.get('roleLocation'))]:
  if phrase in text and location_accessible(places,pid):
   if phrase in ['我这里','我这儿','我身边','找我'] and state.get('_userTravelling'):return None,'place_ambiguous'
   return pid,''
 return None,'place_missing'

def extract(text,anchor,offset,state,places):
 value=intent(text)
 if not value:return {'eligible':False,'reason':'not_explicit_request'}
 timing,reason=when(value,anchor,offset)
 if not timing:return {'eligible':False,'reason':reason,'needsClarification':True}
 pid,reason=destination(value,state,places)
 if not pid:return {'eligible':False,'reason':reason,'needsClarification':True}
 return {'eligible':True,**timing,'locationId':pid,'durationMinutes':60}
