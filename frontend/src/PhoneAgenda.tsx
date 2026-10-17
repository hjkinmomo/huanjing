import type {ChatSnapshot} from './chat-types';
const kinds:Record<string,string>={weekday:'平日',weekend:'周末',holiday:'假日'};
const sources:Record<string,string>={manual:'手工安排', 'saved-content':'已保存的生活设定',default:'默认作息初稿'};
export function PhoneAgenda({s}:{s:ChatSnapshot}){
 const agenda=s.worldLife?.agenda;if(!agenda)return null;
 return <section className="phone-today-agenda" aria-label="今天的安排">
  <header><div><span>今天的安排</span><h3>{agenda.displayDate}</h3></div><small>{agenda.holidayName||kinds[agenda.dayKind]}</small></header>
  <article className="agenda-current"><span>此刻 · 实际状态</span><strong>{agenda.current.enRoute?'正在路上':agenda.current.placeName}</strong><p>{agenda.current.activity}</p></article>
  {agenda.sharingRequired?<p className="agenda-sharing-note">共享行迹后可查看完整安排；这里只显示与你有关的已确认约定。在“行迹绑定”中申请，由对方自主决定。</p>:<>
   <p className="agenda-plan-note">{sources[agenda.source]}{agenda.enabled?'':' · 日常生活未启用'}。以下是计划，已过时间不代表已经完成。</p>
  </>}
  {agenda.next&&<p className="agenda-next">下一段{agenda.next.kind==='wish-window'?'心愿窗口':'计划'} <time>{agenda.next.at}</time> · {agenda.next.activity}</p>}
  <ol className="agenda-plan-list">{agenda.entries.map((entry:any)=><li key={entry.id} data-kind={entry.kind} data-past={entry.timePassed}>
   <time>{entry.at}{entry.windowEnd&&<span>至 {entry.windowEnd}</span>}</time>
   <div><strong>{entry.activity}</strong><span>{entry.placeName}</span>{entry.kind==='wish-window'&&<span>条件合适再考虑，也可以不去</span>}{entry.conflict&&<span>与约定重叠，按实际行程继续</span>}</div>
   <small>{entry.kind==='commitment'?(entry.actualArrival?'已抵达':'已确认'):entry.kind==='wish-window'?'心愿':entry.timePassed?'原计划':'作息'}</small>
  </li>)}</ol>
  {agenda.configWarning&&<p role="status">{agenda.configWarning}</p>}
 </section>;
}
