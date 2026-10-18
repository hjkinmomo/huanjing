import {useState} from 'react';
import type {ChatActions} from './chat-types';
export function ScheduleChangeCard({change:c,actions,offset=480}:{change:any;actions:ChatActions;offset?:number}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');const at=new Date(Date.parse(c.at)+offset*60000),date=`新历${at.getUTCFullYear()-1700}年${at.getUTCMonth()+1}月${at.getUTCDate()}日 ${at.toISOString().slice(11,16)}`;
 async function decide(confirm:boolean){if(busy)return;setBusy(true);setError('');try{await actions.phoneLifeAction?.('world_commitment_confirm',{id:c.id,expectedRevision:c.revision,confirm});}catch(e){setError(e instanceof Error?e.message:'没有更改原日程，请重新确认。');}finally{setBusy(false);}}
 return <section className="schedule-change-card" aria-label="确认更改日程"><strong>要把这次约定加入日程吗？</strong><p>对方已经同意，确认后才会更改安排。</p><p>{date} · {c.timeKind==='departure'?'出发前往':'预计到达'} {c.placeName}</p>{c.reason&&<p>{c.reason}</p>}<small>按实际路线行动；你的地点不会被自动更改。</small><footer><button type="button" disabled={busy} onClick={()=>void decide(true)}>确认更改日程</button><button type="button" disabled={busy} onClick={()=>void decide(false)}>保留原日程</button></footer>{error&&<p role="alert">{error}</p>}</section>;
}
