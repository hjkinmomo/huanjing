import {useEffect, useState, type RefObject} from 'react';
import type {ChatActions, ChatSnapshot} from './chat-types';
import {userStickerOptions} from '../../web/assets/experience/user-stickers.mjs';
import {StickerArt} from './StickerArt';

export function fitComposerTextarea(node: HTMLTextAreaElement | null) {
  if (!node || !node.isConnected || !node.getClientRects().length) return;
  node.style.height = 'auto';
  const border = node.offsetHeight - node.clientHeight;
  const limit = node.dataset.collapsed === 'true' ? 44 : Math.min(200, window.innerHeight * .25);
  const height = Math.max(40, Math.min(limit, node.scrollHeight + border));
  node.style.height = `${height}px`;
  node.style.overflowY = node.scrollHeight > height + 1 ? 'auto' : 'hidden';
}

export function ChatComposer({snapshot: s, actions, messageRef}: {
  snapshot: ChatSnapshot; actions: ChatActions; messageRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const [stickersOpen,setStickersOpen]=useState(false),[collapsed,setCollapsed]=useState(false);
  useEffect(()=>{if(messageRef.current){messageRef.current.dataset.collapsed=String(collapsed);fitComposerTextarea(messageRef.current);}},[collapsed]);
  useEffect(()=>setStickersOpen(false),[s.roleId,s.conversationId]);
  useEffect(() => {
    const resize = () => fitComposerTextarea(messageRef.current);
    resize(); window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [messageRef, s.roleId]);
  const blocked=s.hasSelectedRole===false||s.chatMode!=='assistant'&&s.worldLife?.enabled&&s.contactChannel!=='phone'&&(!s.worldLife.valid||!s.worldLife.coLocated);
  return <form id="composer" className="composer" onSubmit={event => {event.preventDefault(); if(!blocked)actions.send();}} onKeyDown={event=>{
    if(stickersOpen&&event.key==='Escape'){
      event.preventDefault();event.stopPropagation();setStickersOpen(false);
      event.currentTarget.querySelector<HTMLButtonElement>('.sticker-trigger')?.focus();
    }
  }}>
    <label className="sr-only" htmlFor="message">写给{s.name}</label>
    <textarea ref={messageRef} id="message" name="message" rows={1} data-collapsed={collapsed} disabled={s.initializing===true||!!blocked} maxLength={12000} autoComplete="off" aria-describedby="composer-help"
      placeholder={s.hasSelectedRole===false?'先选择一位角色':`想和${s.name}说些什么？`} onChange={event => {
        fitComposerTextarea(event.currentTarget); actions.draftChanged(event.currentTarget.value);
      }} onKeyDown={event => {
        const sendModifier = s.sendKey === 'ctrl-enter' ? (event.ctrlKey || event.metaKey) : !event.ctrlKey && !event.metaKey;
        if (event.key === 'Enter' && sendModifier && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
          event.preventDefault(); if(!blocked)actions.send();
        }
      }}/>
    <div className="composer-footer">
      <span id="composer-help">{s.sendKey === 'ctrl-enter' ? 'Ctrl / ⌘ + Enter 发送 · Enter 换行' : 'Enter 发送 · Shift + Enter 换行'}</span>
      <label className="composer-task-toggle" title={s.agentTools?"可查资料和使用授权工具":"日常聊天只读取扮演技巧与场景"}><input type="checkbox" checked={s.agentTools===true} disabled={s.busy||s.initializing||s.memoryPolicy==='readonly'} onChange={e=>actions.agentToolsChanged?.(e.target.checked)}/><span>任务能力</span><small>{s.agentTools?"授权工具":"扮演技巧与场景"}</small></label>
      <button type="button" className="composer-collapse" aria-label={collapsed?'展开输入框':'收起输入框'} aria-pressed={collapsed} onClick={()=>setCollapsed(!collapsed)}>{collapsed?'展开':'收起'}</button>
      <button type="button" className="sticker-trigger" aria-expanded={stickersOpen} aria-controls="user-sticker-picker" disabled={s.busy||s.initializing||!!blocked} onClick={()=>setStickersOpen(!stickersOpen)}>表情</button>
      {s.canStop && <button type="button" className="primary stop-reply" onClick={() => actions.stop?.()}><span aria-hidden="true">■</span> 停止生成</button>}
      <button type="submit" id="send" className="primary" hidden={!!s.canStop} disabled={s.busy||s.initializing||!!blocked}>{s.busy ? '正在回复…' : '发送'}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 14-7-5 14-2-6-7-1Zm7 1 7-8"/></svg></button>
    </div>
    {stickersOpen&&<section id="user-sticker-picker" className="user-sticker-picker" aria-label="发送表情"><div className="sticker-picker-heading"><span>点选发送 · 保留文字草稿</span><button type="button" onClick={()=>setStickersOpen(false)} aria-label="关闭表情面板">×</button></div><div className="user-sticker-grid">{userStickerOptions(s.roleId).map(sticker=><button key={sticker.id} type="button" disabled={s.busy} title={sticker.meaning} aria-label={`发送表情：${sticker.label}`} onClick={()=>{actions.sendSticker?.(sticker.id);setStickersOpen(false);}}><StickerArt src={sticker.src} sprite={sticker.sprite} label={sticker.label} className="sticker-option-art" loading="lazy"/><span>{sticker.label}</span></button>)}</div></section>}
  </form>;
}
