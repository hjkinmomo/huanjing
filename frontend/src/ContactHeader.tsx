import {useEffect,useState} from 'react';
import type {ChatActions,ChatSnapshot} from './chat-types';
export function ContactHeader({snapshot:s,actions}:{snapshot:ChatSnapshot;actions:ChatActions}){
 const [reading,setReading]=useState(false);
 const l=s.worldLife,phone=s.contactChannel==='phone',blocked=s.chatMode!=='assistant'&&l?.enabled&&!phone&&(!l.valid||!l.coLocated);
 useEffect(()=>{setReading(false);},[s.roleId,s.conversationId,blocked]);
 if(s.hasSelectedRole===false)return <div className="contact-interruption"><section className="contact-state-card"><h3>选择一位角色，展开新故事</h3><p>先把喜欢的角色选入左侧列表，再为他创建新聊天。</p><div className="contact-state-actions"><button type="button" className="primary" onClick={()=>actions.manageRoles?.()}>选择角色</button></div></section></div>;
 if(s.chatMode==='assistant')return null;
 if(s.roleRoster?.find(r=>r.id===s.roleId)?.online===false)return <div className="contact-interruption"><section className="contact-state-card"><h3>开始与{s.name}的新故事</h3><p>创建新对话后，这位角色才会进入你的生活。</p><div className="contact-state-actions"><button className="primary" onClick={()=>actions.newConversation?.()}>创建新对话</button></div></section></div>;
 return <>
 {phone&&<header className="phone-contact-header"><strong>与{s.name}远程联系</strong><button type="button" onClick={()=>actions.contactChannelChanged?.('offline')}>返回线下</button></header>}
 {blocked&&(reading?<div className="contact-reading-note"><span>线下对话暂停</span><button type="button" onClick={()=>setReading(false)}>查看双方位置</button><button type="button" onClick={()=>actions.openPhone?.('home')}>打开手机</button></div>:<div className="contact-interruption">
  <section className="contact-state-card" aria-label="线下对话暂停">
   <div className="contact-distance-art" aria-hidden="true"><i/><span>···</span><i/></div>
   <p className="contact-state-kicker">此刻，隔着一段距离</p>
   <h3>{l.valid?'先用手机聊吧':'地点暂不可用'}</h3>
   <dl><div><dt>你在</dt><dd>{l.user?.name||'尚未记录'}</dd></div><div><dt>{s.name}在</dt><dd>{l.character?.name||'尚未记录'}</dd></div></dl>
   <p className="contact-state-copy">需要打开手机去聊天。见面后可继续这里的对话，输入草稿已保留。</p>
   <div className="contact-state-actions"><button type="button" className="primary" onClick={()=>actions.openPhone?.('home')}>打开手机</button></div>
  </section>
 </div>)}
 {s.lifeError&&<p className="location-read-error" role="status">{s.lifeError}<button type="button" onClick={()=>actions.refreshWorldLife?.()}>重新读取</button></p>}
 </>;
}
