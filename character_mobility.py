"""Bounded fictional travel intent; never changes the user's position or real files."""
import re
from chat_appointments import plain,timed_intent
def requested_character_travel(messages):
    last=next((m.get('content','') for m in reversed(messages) if m.get('role')=='user'),'')
    if not isinstance(last,str) or len(last)>12000:return False
    if timed_intent(last):return False
    last=plain(last)
    if any(t in last for t in ['引用','台词','复述','转述','演示','改写','翻译','他说','她说']):return False
    # Quoted examples, conditional plans, and negations do not authorize arrival.
    if any(t in last for t in ('不要','别去','别来','不许','不能','不用去','如果','假如','要是','比如','举例','小说里','梦里','明天','后天','下周','稍后')):return False
    return bool(re.search(r'(?:你|我们|咱们|一起|陪我)\s*(?:现在|先|可以|能不能|要不要|请|就|直接|赶紧|能|愿意|跟我|一起)?\s*(?:前往|过去|过来|去|来|到)',last) or re.match(r'^\s*(?:请)?(?:去|来|前往|到).{1,80}',last))
