import {PhoneSocialLedger} from './PhoneSocial';
import {CharacterContentEditor} from './CharacterContentEditor';
import {PhoneCommitments} from './PhoneCommitments';
import {PhoneAgenda} from './PhoneAgenda';
import {PhoneBindings} from './PhoneBindings';
import {useEffect,useRef,useState} from 'react';
import {PhoneDelivery} from './PhoneDelivery';
import {TimeControls} from './TimeControls';
import {UiIcon} from './UiIcon';
import type {ChatActions,ChatSnapshot} from './chat-types';

export function PhoneLifeApps({app,s,actions,initialMerchant=''}:{initialMerchant?:string;app:string;s:ChatSnapshot;actions:ChatActions}){
 const [socialOpen,setSocialOpen]=useState(false);
 const [working,setWorking]=useState(false),[note,setNote]=useState(''),[date,setDate]=useState(''),[confirm,setConfirm]=useState<string|null>(null);
 const alive=useRef(true);useEffect(()=>()=>{alive.current=false;},[]);
 const life=s.worldLife;
 async function run(fn:()=>Promise<unknown>){if(working)return;setWorking(true);setNote('');try{await fn();setNote('已保存');setConfirm(null);}catch(e){setNote(e instanceof Error?e.message:'未能保存，原数据保留。');}finally{setWorking(false);}}
 if(app==='journal')return <PhoneBindings s={s} actions={actions}/>;
 if(app==='delivery')return <PhoneDelivery initialMerchant={initialMerchant} s={s} actions={actions}/>;
 if(app==='schedule'&&life?.established===false)return <p className="phone-empty">先创建这位角色的新对话，再安排他的生活。<button onClick={()=>actions.newConversation?.()}>创建新对话</button></p>;
 if(!life?.enabled)return <p className="phone-empty">这段对话还没有绑定世界。新建对话时选择都市与起点，即可安排日程。</p>;
 return <section className="phone-life-app"><header><time>{life.worldTime}</time><span>{s.name} · 当前会话</span></header><PhoneAgenda s={s} actions={actions}/><PhoneCommitments key={s.roleId+':'+s.conversationId} s={s} actions={actions}/><details className="agenda-editor"><summary>编辑日程与生活</summary>{<><label className="life-switch"><span><strong>日常生活</strong><small>按日程行动，与你分开时可以发手机消息</small></span><input type="checkbox" checked={life.autonomy?.enabled===true} disabled={working} onChange={e=>run(()=>actions.worldAutonomyChanged!({enabled:e.target.checked,outreach:true}))}/></label><label className="life-switch"><span>主动发来消息</span><input type="checkbox" disabled={working||!life.autonomy?.enabled} checked={life.autonomy?.enabled===true&&life.autonomy?.outreach!==false} onChange={e=>run(()=>actions.worldAutonomyChanged!({enabled:true,outreach:e.target.checked}))}/></label><ScheduleEditor key={s.roleId+':'+s.conversationId+':'+life.autonomy?.startedAt} s={s} disabled={working} save={value=>run(()=>actions.worldScheduleChanged!(value))}/><details className="role-content-panel" onToggle={e=>setSocialOpen(e.currentTarget.open)}><summary>公开资料与相遇</summary>{socialOpen&&<PhoneSocialLedger s={s} actions={actions}/>}</details><details className="role-content-panel"><summary>故事与生活内容</summary><CharacterContentEditor s={s} actions={actions}/></details><details className="life-templates"><summary>消息用语</summary><p>本地日程消息的用语，可按角色改写。用 {'{地点}'}、{'{活动}'} 引用当前账本；实时聊天仍使用原人格。</p><TemplateEditor key={s.roleId+String(life.autonomy?.startedAt)} value={life.autonomy} disabled={working} save={patch=>run(()=>actions.worldAutonomyChanged!({enabled:life.autonomy?.enabled===true,outreach:life.autonomy?.outreach!==false,...patch}))}/></details></>}</details>{note&&<p role="status">{note}</p>}</section>;
}
function ScheduleEditor({s,disabled,save}:{s:ChatSnapshot;disabled:boolean;save:(value:any)=>void}){
 const schedule=s.worldLife?.schedule,[slots,setSlots]=useState(()=>schedule?.slots.map(row=>({...row}))||[]),[enabled,setEnabled]=useState(schedule?.enabled===true);
 return <section className="life-schedule"><h3>一天的安排</h3><label className="life-switch"><span>按日程换地点</span><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)} disabled={disabled}/></label>{slots.map((slot,index)=><div className="life-schedule-row" key={index}><input aria-label={'日程时间 '+(index+1)} type="time" value={slot.at} disabled={index===0||disabled} onChange={e=>setSlots(rows=>rows.map((row,i)=>i===index?{...row,at:e.target.value}:row))}/><select aria-label={'日程地点 '+(index+1)} value={slot.locationId} onChange={e=>setSlots(rows=>rows.map((row,i)=>i===index?{...row,locationId:e.target.value}:row))}>{s.worldMap?.locations.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select><input aria-label={'日程活动 '+(index+1)} value={slot.activity} maxLength={160} onChange={e=>setSlots(rows=>rows.map((row,i)=>i===index?{...row,activity:e.target.value}:row))}/>{index>0&&<button aria-label={'删除日程 '+(index+1)} onClick={()=>setSlots(rows=>rows.filter((_,i)=>i!==index))}>×</button>}</div>)}<footer><button disabled={disabled||slots.length>=16} onClick={()=>setSlots(rows=>[...rows,{at:'21:00',locationId:s.worldLife?.character?.locationId||s.worldMap?.currentId||'',activity:'自由活动'}])}>＋ 一段安排</button><button disabled={disabled} onClick={()=>save({enabled,slots:[...slots].sort((a,b)=>a.at.localeCompare(b.at))})}>保存日程</button></footer></section>;
}
function TemplateEditor({value,disabled,save}:{value:any;disabled:boolean;save:(patch:any)=>void}){
 const [greeting,setGreeting]=useState(value?.greetingText||'我在{地点}。你有空的话，我们聊一会儿？'),[meal,setMeal]=useState(value?.mealText||'我准备在{地点}吃饭，要不要一起？我等你五分钟。');
 return <><label>日常联系<textarea value={greeting} maxLength={300} onChange={e=>setGreeting(e.target.value)}/></label><label>用餐邀约<textarea value={meal} maxLength={300} onChange={e=>setMeal(e.target.value)}/></label><button disabled={disabled} onClick={()=>save({greetingText:greeting,mealText:meal})}>保存用语</button></>;
}
