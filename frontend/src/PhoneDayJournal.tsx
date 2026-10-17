import {useState} from 'react';
import type {ChatSnapshot,ChatActions} from './chat-types';
function Day({day,peer,s,actions}:{day:any;peer:any;s:ChatSnapshot;actions:ChatActions}){
 const [items,setItems]=useState<any[]>([]),[cursor,setCursor]=useState(0),[loaded,setLoaded]=useState(false),[more,setMore]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function load(){if(busy||!actions.loadWorldJournal)return;setBusy(true);setError('');try{
  const r=await actions.loadWorldJournal({roleId:peer.roleId,sessionId:peer.sessionId,day:day.day,after:cursor});
  if(r.day!==day.day||!Array.isArray(r.items)||!Number.isInteger(r.nextAfter))throw Error('这一天的记录尚未读取，请重试。');
  setItems(old=>[...old,...r.items.filter((n:any)=>!old.some(e=>e.id===n.id))]);setCursor(r.nextAfter);setMore(r.hasMore===true);setLoaded(true);
 }catch(e){setError(e instanceof Error?e.message:'记录暂未读取。');}finally{setBusy(false);}}
 return <details className="day-journal" onToggle={e=>{if(e.currentTarget.open&&!loaded&&!busy)void load();}}>
  <summary><span>{day.displayDate}</span><small>{day.eventCount?`${day.eventCount} 条事实`:'没有已记录事实'}</small></summary>
  <p>{day.note}</p><ol className="life-timeline">{items.map(e=><li key={e.id}><time>{new Date(Date.parse(e.worldUtc)+(s.worldLife?.utcOffsetMinutes??480)*60000).toISOString().slice(11,16)}</time><strong>{e.title}</strong></li>)}</ol>
  {busy&&<p role="status">正在读取记录…</p>}{error&&<p role="status">{error}</p>}{(more||error)&&<button disabled={busy} onClick={()=>void load()}>{error?'重试':'继续查看'}</button>}
 </details>;
}
export function PhoneDayJournal({peer,s,actions}:{peer:any;s:ChatSnapshot;actions:ChatActions}){
 return <section className="phone-day-journals" aria-label="每日事实记录"><h4>每日记录</h4><p>只汇总实际留下的记录，展开查看原始行迹。</p>{(peer.dayJournals||[]).map((day:any)=><Day key={day.day} day={day} peer={peer} s={s} actions={actions}/>)}{!peer.dayJournals?.length&&<p>这一天结束后，会留下事实结算。</p>}{peer.dayJournalCatchUpLimited&&<p>较长离线只补最近两天的结算；更早原记录仍保留。</p>}</section>;
}
