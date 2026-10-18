"""Fictional New Era calendar. Dates keep the existing saved-world epoch."""
from datetime import datetime,timedelta
import calendar,copy,json
from pathlib import Path

def label(day):return f'新历{day.year-1700}年{day.month}月{day.day}日'
def local_time(state,stamp):
 p=state['timePolicy'];return datetime.fromisoformat(stamp)+timedelta(seconds=p.get('clockOffsetSeconds',0),minutes=p['utcOffsetMinutes'])
def day_info(config,day):
 holiday=next((h for h in config.get('holidays',[]) if h['month']==day.month and h['day']==day.day and (h.get('year') is None or h['year']==day.year-1700)),None)
 off=bool(holiday and holiday.get('rest',True)) or day.isoweekday() in config.get('weekendDays',[6,7])
 return {'date':day.date().isoformat(),'displayDate':label(day),'weekday':day.isoweekday(),'kind':'holiday' if holiday and holiday.get('rest',True) else 'weekend' if day.isoweekday() in config.get('weekendDays',[6,7]) else 'weekday','holiday':(holiday or {}).get('name',''),'off':off,'restLabel':'休息日' if off else '工作日'}
def month_grid(config,year,month):
 first=datetime(year,month,1);start=first-timedelta(days=first.weekday())
 return [{**day_info(config,start+timedelta(days=i)),'inMonth':(start+timedelta(days=i)).month==month,'day':(start+timedelta(days=i)).day} for i in range(42)]

LAWS=[
 {'title':'历法','text':'夏城采用新历：十二个月、每周七日。日期沿用故事已有纪元，所有日程由项目内的世界时钟推进。'},
 {'title':'常规工学日','text':'常规岗位与学校每周一至周五安排工作或课程，周六、周日休息。常规每日工作不超过八小时，午餐与通勤单独安排。'},
 {'title':'节日休息','text':'标为休息的节日不安排常规工作与课程；与周末重叠不补班、不调休。节日前后也不借用双休日。'},
 {'title':'必要轮班','text':'餐饮、医疗、交通等轮班可在休息日安排，但须在日程中注明轮班缘由及补休；不会自动假设所有人每天上班。'},
 {'title':'行程与约定','text':'日程地点表示该时段开始出发，抵达以路线账本为准。约定可指定出发或到达时间；已经答应的约定优先，需要更改时明确商量。'},
 {'title':'计划与自主性','text':'日程只安排活动和位置。临时决定、请假、拒绝与改主意均可记录，经过时间不会自动完成人生目标。'},
]
