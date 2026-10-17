import {UiIcon} from './UiIcon';
import {PhoneShell} from './PhoneShell';
import {offlineMessages} from '../../web/assets/experience/phone-core.mjs';
import {useState, useEffect, useRef, type RefObject} from 'react';
import {MessageItem, ReplyProgress} from './MessageItem';
import {ChatComposer} from './ChatComposer';
import {Avatar} from './Avatar';
import {RoleCard} from './RoleCard';
import {ContactHeader} from './ContactHeader';
import {CharacterRail} from './CharacterRail';
import {RoleRoster} from './RoleRoster';
import type {ChatActions,ChatSnapshot} from './chat-types';

export function ChatView({snapshot:s,actions,messageRef,messagesRef}:{
  snapshot:ChatSnapshot;actions:ChatActions;
  messageRef:RefObject<HTMLTextAreaElement|null>;
  messagesRef:RefObject<HTMLDivElement|null>;
}) {
  const [searchOpen,setSearchOpen]=useState(false),[query,setQuery]=useState('');
  const [cardVisible,setCardVisible]=useState(()=>{try{return localStorage.getItem('hermes_chat_card_visible_v1')!=='false';}catch{return true;}});
  function toggleCard(){setCardVisible(v=>{try{localStorage.setItem('hermes_chat_card_visible_v1',String(!v));}catch{}return !v;});}
  const [focused,setFocused]=useState(()=>{try{return localStorage.getItem('hermes_chat_focus_v1')==='true';}catch{return false;}}),conversationRef=useRef<HTMLDivElement>(null);
  function toggleFocus(){setFocused(v=>{try{localStorage.setItem('hermes_chat_focus_v1',String(!v));}catch{}return !v;});}
  const [cardOpen,setCardOpen]=useState(false),cardDialog=useRef<HTMLDialogElement>(null),cardTrigger=useRef<HTMLButtonElement>(null);
  useEffect(()=>{if(cardOpen)cardDialog.current?.showModal();else cardDialog.current?.close();},[cardOpen]);
  useEffect(()=>{setCardOpen(false);},[s.roleId]);
  const moreRef=useRef<HTMLDetailsElement>(null);
  useEffect(()=>{const outside=(e:Event)=>{const menu=moreRef.current;if(menu?.open&&!menu.contains(e.target as Node))menu.open=false;};document.addEventListener('pointerdown',outside);document.addEventListener('focusin',outside);return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('focusin',outside);};},[]);
  useEffect(()=>{if(moreRef.current)moreRef.current.open=false;},[s.roleId,s.conversationId]);
  const searchRef=useRef<HTMLInputElement>(null);
  const previousScroll=useRef(0),contentRef=useRef<HTMLDivElement>(null),followRef=useRef(true);
  const [awayFromBottom,setAwayFromBottom]=useState(false);
  const blocked=s.chatMode!=='assistant'&&s.worldLife?.enabled&&s.contactChannel!=='phone'&&(!s.worldLife.valid||!s.worldLife.coLocated);
  const physical=offlineMessages(s.messages),physicalPartial=s.partial?.channel!=='phone'?s.partial:null;
  const partialVisible=!!(physicalPartial?.id&&(physicalPartial.text||physicalPartial.reasoning));
  const displayed=partialVisible&&!physical.some(m=>m.id===s.partial!.id)?[...physical,{id:s.partial!.id!,from:'role',text:s.partial!.text,reasoning:s.partial!.reasoning,reasoningTruncated:s.partial!.reasoningTruncated,incomplete:true,generating:s.busy&&s.partial!.status==='generating'}]:physical;
  const matches=query.trim()?displayed.filter(m=>(m.text||'').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())):displayed;
  useEffect(()=>{setQuery('');setSearchOpen(false);},[s.roleId,s.conversationId]);
  useEffect(()=>{if(searchOpen)searchRef.current?.focus();},[searchOpen]);
  useEffect(()=>{if(!contentRef.current)return;const observer=new ResizeObserver(()=>{if(followRef.current&&!searchOpen&&messagesRef.current)messagesRef.current.scrollTop=messagesRef.current.scrollHeight;});observer.observe(contentRef.current);return()=>observer.disconnect();},[searchOpen,s.roleId,s.conversationId]);
  function toggleSearch(){
    if(!searchOpen)previousScroll.current=messagesRef.current?.scrollTop||0;
    else {setQuery('');requestAnimationFrame(()=>{if(messagesRef.current)messagesRef.current.scrollTop=previousScroll.current;});}
    setSearchOpen(!searchOpen);
  }
  return <>
    <PhoneShell snapshot={s} actions={actions}/>
    <RoleRoster snapshot={s} actions={actions}/>
    <div ref={conversationRef} className="conversation" data-selected={s.hasSelectedRole!==false} data-focused={focused} data-contact-channel={s.contactChannel||'offline'} data-memory-policy={s.memoryPolicy||'normal'}>
      <header className="conversation-header">
        <div className="conversation-identity"><span className="persona-mode-light" data-mode={s.personaMode||'normal'} role="img" aria-label={s.personaMode==='special'?'特殊模式':'正常模式'} title={s.personaMode==='special'?'特殊模式':'正常模式'}/>{s.hasSelectedRole!==false&&<Avatar key={`avatar:${s.avatar}`} src={s.avatar} name={s.name} id="role-avatar" className="role-avatar"/>}<div><span className="eyebrow">{s.chatMode==='assistant'?'普通助手':'角色对话'}</span><h2 id="conversation-title">{s.hasSelectedRole===false?'选择角色后开始':!s.messages.length&&s.conversationTitle==='之前的聊天'?'新对话':s.conversationTitle||`和${s.name}，慢慢聊。`}</h2></div></div>
        <div className="conversation-actions"><div className="connection-context"><button type="button" id="connection" className="connection" data-ready={s.ready} onClick={()=>actions.navigate('settings')} aria-label={`${s.connectionLabel}，打开连接设置`}>{s.connectionLabel}</button><div className="context-meter" title="本会话最近一次请求用量，包含提示、记忆、场景及历史；估算与实际用量分别标注。"><progress aria-label="上下文用量" value={Math.min(s.contextUsage?.used||0,s.contextUsage?.limit||1048576)} max={s.contextUsage?.limit||1048576}/><small>{s.contextUsage?.estimated?'估算':'用量'} {Intl.NumberFormat('zh-CN',{notation:'compact',maximumFractionDigits:1}).format(s.contextUsage?.used||0)} / {Intl.NumberFormat('zh-CN',{notation:'compact',maximumFractionDigits:1}).format(s.contextUsage?.limit||1048576)} · {((s.contextUsage?.used||0)/(s.contextUsage?.limit||1048576)*100).toFixed(1)}%</small></div></div><div className="chat-tools"><button type="button" className="search-trigger card-panel-trigger" aria-pressed={cardVisible&&!focused} onClick={toggleCard} disabled={focused||s.hasSelectedRole===false}>角色卡</button>
          <button type="button" className="search-trigger focus-trigger" aria-pressed={focused} onClick={toggleFocus}>{focused?'退出专注':'专注聊天'}</button>
          <button type="button" className="search-trigger rail-fallback" disabled={s.initializing||s.busy} onClick={()=>actions.newConversation?.()}>新对话</button>
          <button type="button" className="search-trigger rail-fallback" disabled={s.initializing} onClick={()=>actions.openHistory?.()}>历史</button>
          <details ref={moreRef} className="chat-more" onKeyDown={e=>{if(e.key==="Escape"){e.currentTarget.open=false;e.currentTarget.querySelector<HTMLDetailsElement>("summary")?.focus();}}}><summary>更多</summary><div className="chat-more-menu" onClick={e=>{if((e.target as HTMLElement).closest("button"))e.currentTarget.parentElement?.removeAttribute("open");}}><button type="button" disabled={s.initializing||s.busy} onClick={()=>actions.newConversation?.()}>新对话</button><button type="button" disabled={s.initializing} onClick={()=>actions.openHistory?.()}>聊天历史</button><button type="button" onClick={()=>actions.navigate('edit')}>角色资料</button><button type="button" onClick={()=>actions.navigate('memory')}>角色记忆</button><button type="button" onClick={toggleSearch}>查找这段对话</button><button type="button" onClick={()=>actions.openReadingSettings?.()}>字号与阅读</button><button type="button" onClick={()=>actions.openStories?.('journey')}>同行故事</button><button type="button" onClick={()=>actions.openStories?.('journal')}>同行手记</button><button type="button" disabled={s.initializing} onClick={()=>actions.exportConversation?.('markdown')}>导出对话</button><button type="button" id="open-bag" className="bag-trigger" onClick={()=>actions.openPhone?.('bag')}>背包<span id="bag-count" className="bag-count" hidden={!s.bagCount}>{s.bagCount}</span></button><label className="thinking-toggle"><input type="checkbox" checked={s.thinking===true} disabled={s.busy||s.initializing} onChange={e=>actions.thinkingChanged?.(e.target.checked)}/>请求模型推理</label><p>开启后，在回复上方展开服务商返回的推理。</p></div></details>
        </div></div>
      </header>
      <button ref={cardTrigger} type="button" className="mobile-card-trigger" aria-haspopup="dialog" onClick={()=>setCardOpen(true)}>查看{s.name}的角色卡 <UiIcon name="expand"/></button>
      {searchOpen&&<div id="chat-search" className="chat-search"><label className="sr-only" htmlFor="chat-search-query">查找当前角色聊天</label><input ref={searchRef} id="chat-search-query" value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Escape')toggleSearch();}} placeholder="搜索这段对话，不会发送给模型"/><span role="status">{query.trim()?`${matches.length} 条`:'当前角色'}</span><button type="button" onClick={toggleSearch} aria-label="关闭聊天查找">×</button></div>}

      <section className="contact-surface" data-blocked={!!blocked} data-channel={s.contactChannel||'offline'} aria-label={s.contactChannel==='phone'?'手机聊天':'面对面聊天'}>
      <div className="reading-area">
      <div ref={messagesRef} id="messages" className="messages" data-reading-position={searchOpen?previousScroll.current:undefined} role="log" aria-label="聊天记录" aria-live="polite" tabIndex={0} onScroll={event=>{const node=event.currentTarget;followRef.current=node.scrollHeight-node.clientHeight-node.scrollTop<160;setAwayFromBottom(!followRef.current);}}>
        <div ref={contentRef} className="message-list-content">{s.openingPrehistory&&<details className="story-prehistory"><summary>到这一刻为止</summary><p>{s.openingPrehistory}</p></details>}
        {!displayed.length && s.hasSelectedRole!==false && <div className="empty-state"><Avatar key={`welcome:${s.avatar}`} src={s.avatar} name={s.name} className="welcome-avatar"/><h3>你好，{s.name}。</h3><p>{s.setupPending&&s.chatMode!=='assistant'?'立绘已就绪。人格、语气与情感设定暂时留白，填写后再开始角色对话。':s.greeting || '不必想好开场。从今天的一件小事，或此刻的心情开始。'}</p>{s.setupPending&&s.chatMode!=='assistant'&&<button type="button" className="connection-setup" onClick={()=>actions.navigate('edit')}>填写角色设定 →</button>}{!s.ready&&<button type="button" className="connection-setup" onClick={()=>actions.navigate('settings')}>连接聊天模型 →</button>}</div>}
        {query.trim()&&!matches.length&&<p className="search-empty">没有找到“{query}”。试试其他词。</p>}
        {matches.map(message=><MessageItem key={`${s.roleId}:${message.id}`} message={message} utcOffsetMinutes={s.worldLife?.utcOffsetMinutes} roleId={s.roleId} name={s.name} avatar={s.avatar} userName={s.userName} userAvatar={s.userAvatar} actions={actions} presentation={s.chatMode!=='assistant'} reveal={s.reveal} animate={s.revealIds?.includes(message.id)&&(!message.incomplete||message.generating)}/>)}
        {!partialVisible&&<ReplyProgress roleId={s.roleId} name={s.name} avatar={s.avatar} busy={s.busy && s.activeContactChannel!=='phone' && !!s.canStop} partial={physicalPartial} chatMode={s.chatMode}/>}
        </div>
      </div>
      <ContactHeader snapshot={s} actions={actions}/>
      {awayFromBottom&&!searchOpen&&<button type="button" className="latest-message" onClick={()=>{messagesRef.current?.scrollTo({top:messagesRef.current.scrollHeight,behavior:document.documentElement.dataset.reduced==='true'?'instant':'smooth'});}}>回到最新 ↓</button>}
      </div>
      <div id="chat-feedback" className="feedback" role="status" hidden={!s.feedback}>{s.feedback}{s.feedbackAction && <button type="button" onClick={s.feedbackAction.run}>{s.feedbackAction.label}</button>}</div>
      <ChatComposer snapshot={s} actions={actions} messageRef={messageRef}/>
      </section>
      <p className="quiet-note" id="chat-note">{s.memoryPolicy==='readonly'?'试聊：角色记忆只读，新的对话不会写入长期记忆。':s.ready?'对话只发送给你配置的模型。':'尚未连接模型。你可以先写下想说的话，草稿会保留。'}</p>
    </div>
    <aside className="portrait-scene" aria-label="当前角色" hidden={focused||!cardVisible}>
      <CharacterRail snapshot={s} actions={actions}/>
    </aside>
    <dialog ref={cardDialog} className="mobile-card-dialog" aria-labelledby="mobile-card-title" onClose={()=>{setCardOpen(false);cardTrigger.current?.focus({preventScroll:true});}}>
      <header><h2 id="mobile-card-title">{s.name}的角色卡</h2><button type="button" aria-label="关闭角色卡" onClick={()=>setCardOpen(false)}>×</button></header>
      {cardOpen&&<RoleCard snapshot={s} actions={actions} imageId="portrait-card-preview"/>}
    </dialog>
  </>;
}

