import {UiIcon} from './UiIcon';
import {appViewport} from '../../web/assets/experience/app-scale.mjs';
import {useEffect,useRef,useState} from 'react';
import {Avatar} from './Avatar';
import type {ChatActions,ChatSnapshot} from './chat-types';

export function RoleRoster({snapshot:s,actions}:{snapshot:ChatSnapshot;actions:ChatActions}){
 const [collapsed,setCollapsed]=useState(()=>{try{return (matchMedia('(max-width:760px)').matches||appViewport().w<1000)||localStorage.getItem('hermes_role_roster_collapsed_v1')==='true';}catch{return false;}});
 const [query,setQuery]=useState(''),toggleRef=useRef<HTMLButtonElement>(null);
 useEffect(()=>{const media=matchMedia('(max-width:760px)');const resized=()=>{if(media.matches||appViewport().w<1000){setCollapsed(true);setQuery('');}else{try{setCollapsed(localStorage.getItem('hermes_role_roster_collapsed_v1')==='true');}catch{}}};media.addEventListener('change',resized);window.addEventListener('huanjing:scale-change',resized);window.addEventListener('resize',resized);return()=>{media.removeEventListener('change',resized);window.removeEventListener('huanjing:scale-change',resized);window.removeEventListener('resize',resized);};},[]);
 const roles=s.roleRoster||[],visible=roles.filter(r=>r.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
 function collapse(value:boolean){setCollapsed(value);if(value)setQuery('');try{localStorage.setItem('hermes_role_roster_collapsed_v1',String(value));}catch{}}
 return <aside className="role-roster" data-collapsed={collapsed} aria-label="独立角色对话" onKeyDown={e=>{if(e.key==='Escape'&&!collapsed){collapse(true);toggleRef.current?.focus();}}}>
  <header className="roster-header"><div className="roster-title"><span>对话</span><small>{s.personaMode==='special'?'特殊角色':'我的角色'} · {roles.length}</small></div><button ref={toggleRef} type="button" className="roster-toggle" aria-expanded={!collapsed} aria-controls="role-roster-body" aria-label={collapsed?'展开角色栏':'收起角色栏'} title={collapsed?'展开角色栏':'收起角色栏'} onClick={()=>collapse(!collapsed)}><UiIcon name={collapsed?'right':'left'}/></button></header>
  {!collapsed&&<button type="button" className="roster-dismiss" aria-label="关闭角色列表" onClick={()=>collapse(true)}/>}
  <div className="role-roster-body" id="role-roster-body">
   <label className="roster-search"><span className="sr-only">查找角色</span><input type="search" placeholder="查找角色" value={query} onChange={e=>setQuery(e.target.value)}/></label>
   <nav className="roster-list" aria-label="选择聊天角色">{visible.map(role=><button key={role.id} type="button" className="roster-item" aria-current={s.roleId===role.id?'true':undefined} aria-label={`和${role.name}聊天${role.busy?'，正在回复':role.unread?'，有新回复':''}`} title={`${role.name} · ${role.status}`} onClick={()=>{actions.selectRole?.(role.id);if(matchMedia('(max-width:760px)').matches)collapse(true);}}>
    <span className="roster-avatar-wrap"><Avatar key={role.avatar} src={role.avatar} name={role.name} className="roster-avatar"/>{(role.busy||role.unread)&&<i className="roster-dot" data-busy={role.busy} aria-hidden="true"/>}</span>
    <span className="roster-copy"><strong>{role.name}</strong><small data-busy={role.busy} data-unread={role.unread}>{role.status}</small></span>{role.online&&<i className="roster-online" aria-label="已创建对话，可手机联系"/>}
   </button>)}</nav>
   {!visible.length&&<p className="roster-empty">{roles.length?'没有找到这个角色。':'还没有选择角色。'}</p>}
   <footer className="roster-footer"><p>各自记忆 · 独立上下文</p><button type="button" onClick={()=>actions.manageRoles?.()} title="选择角色" aria-label="选择角色"><UiIcon name="user"/><span className="roster-footer-copy">选择角色</span></button><button type="button" onClick={()=>actions.createRole?.()} title="添加新角色" aria-label="添加新角色"><UiIcon name="plus"/><span className="roster-footer-copy">添加新角色</span></button></footer>
  </div>
 </aside>;
}


