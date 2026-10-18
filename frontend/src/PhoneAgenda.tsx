import {useState} from 'react';
import type {ChatSnapshot,ChatActions} from './chat-types';
const kinds:Record<string,string>={weekday:'平日',weekend:'周末',holiday:'假日'};
const sources:Record<string,string>={manual:'手工安排', 'saved-content':'已保存的生活设定',default:'默认作息初稿'};
export function PhoneAgenda({s,actions}:{s:ChatSnapshot;actions:ChatActions}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const agenda=s.worldLife?.agenda;if(!agenda)return null;
 const plan=agenda.planning||{},labels:Record<string,string>={ready:'正在准备今天的安排',running:'正在结合自己的目标安排今天',waiting_configuration:'等待模型连接，暂按自己的作息生活',done:plan.weekStart?'本周计划已保存，按今天的安排生活':plan.plannedBlocks?'已结合自己的目标安排今天':'今天先按自己的作息生活',failed:plan.weekStart?'本周规划未完成，继续按已有安排生活':'今天的安排未生成完成，继续按已有作息生活',disabled:'日常生活已关闭',manual:'按手工日程生活','no-active-goal':'目前没有待推进的目标，按自己的作息生活','revision-limit':'今天目标修改较多，暂保留已知作息',stale:'目标或当前故事已变化，保留现有作息'};
 async function retry(){setBusy(true);setError('');try{await actions.retryDayPlan?.(plan.id);}catch(e){setError(e instanceof Error?e.message:'重新安排未完成');}finally{setBusy(false);}}
 return <section className="phone-today-agenda" aria-label="今天的安排">
  <header><div><span>今天的安排</span><h3>{agenda.displayDate}</h3></div><small>{agenda.holidayName||kinds[agenda.dayKind]}</small></header>
  <article className="agenda-current"><span>此刻 · 实际状态</span><strong>{agenda.current.enRoute?'正在路上':agenda.current.placeName}</strong><p>{agenda.current.activity}</p></article>
  <button type="button" onClick={()=>actions.openWeekPlanner?.()}>打开周历与日程</button>
  {labels[plan.status]&&<div className="agenda-planning-state" role="status"><p>{labels[plan.status]}</p>{plan.status==='failed'&&<p>{plan.issue==='model'?'这位角色的模型连接未完成，请先检查连接设置。':plan.issue==='interrupted'?'上次安排被中断，需要确认后重试。':'安排未通过时间、路线或格式检查，可以重新安排。'}</p>}{plan.status==='failed'&&!plan.weekStart&&actions.retryDayPlan&&<button disabled={busy} onClick={retry}>{busy?'正在提交…':'重新安排今天'}</button>}{error&&<p role="alert">{error}</p>}</div>}
  {agenda.sharingRequired?<p className="agenda-sharing-note">共享行迹后可查看完整安排；这里只显示与你有关的已确认约定。在“行迹绑定”中申请，由对方自主决定。</p>:<>
   <p className="agenda-plan-note">{sources[agenda.source]}{agenda.enabled?'':' · 日常生活未启用'}。以下是计划，已过时间不代表已经完成。</p>
  </>}
  {agenda.next&&<p className="agenda-next">下一段{agenda.next.kind==='wish-window'?'心愿窗口':'计划'} <time>{agenda.next.at}</time> · {agenda.next.activity}</p>}
  <ol className="agenda-plan-list">{agenda.entries.map((entry:any)=><li key={entry.id} data-kind={entry.kind} data-past={entry.timePassed}>
   <time>{entry.at}{entry.windowEnd&&<span>至 {entry.windowEnd}</span>}</time>
   <div><strong>{entry.activity}</strong><span>{entry.placeName}</span>{entry.kind==='wish-window'&&<span>条件合适再考虑，也可以不去</span>}{entry.conflict&&<span>与约定重叠，按实际行程继续</span>}</div>
   <small>{entry.kind==='commitment'?(entry.actualArrival?'已抵达':'已确认'):entry.kind==='wish-window'?'心愿':entry.goalPlanId?(entry.timePassed?'目标安排':'目标计划'):entry.timePassed?'原计划':'作息'}</small>
  </li>)}</ol>
  {agenda.configWarning&&<p role="status">{agenda.configWarning}</p>}
 </section>;
}
