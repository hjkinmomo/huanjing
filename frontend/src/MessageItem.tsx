import {SCENE_NOTICES,normalizeSceneNotices} from '../../web/assets/experience/scene-notices.mjs';
import {MessageContent, MessageAttachments} from './MessageContent';
import {ReplyBubbles} from './ReplyBubbles';
import {ReasoningPanel} from './ReasoningPanel';
import {Avatar} from './Avatar';
import {CopyButton} from './CopyButton';
import type {Message, ChatActions, ChatSnapshot} from './chat-types';
import {parseUserSticker} from '../../web/assets/experience/user-stickers.mjs';
import {StickerArt} from './StickerArt';

export function MessageItem({message, name, avatar, userName='你', userAvatar='', actions, roleId,presentation=true,animate=false,reveal,utcOffsetMinutes=480,phoneView=false}: {
  phoneView?:boolean;utcOffsetMinutes?:number;roleId: string; message: Message; name: string; avatar: string; userName?:string;userAvatar?:string; actions: ChatActions;presentation?:boolean;animate?:boolean;reveal?:ChatSnapshot['reveal'];
}) {
  const user = message.from === 'user';
  const notices=normalizeSceneNotices(message.sceneNotices);
  const generating=message.generating===true;
  const scoreCard=user&&message.text?.match(/^🎮 游戏战绩\n([^\n]+) · (\d+) 分\n(\d+) 步 · 评级 ([A-Za-z]+)\n/);
  const sticker=user?parseUserSticker(message.text||'',roleId):null;
  const date = message.createdAt ? new Date(message.createdAt) : null;
  const worldDate=message.worldUtc?new Date(Date.parse(message.worldUtc)+utcOffsetMinutes*60000):null;
  const validDate = date && !Number.isNaN(date.getTime());
  return <article className={phoneView?"message phone-message-row":"message"} data-message-id={message.id} data-sender={message.from} data-generating={generating}>
    {!user ? phoneView?<button className="phone-avatar-button" title="查看联系人资料" aria-label="查看联系人资料" onClick={()=>actions.openPhoneContact?.('role')}><Avatar key={avatar} name={name} src={avatar} className="message-avatar"/></button>:<Avatar key={avatar} name={name} src={avatar} className="message-avatar"/> : <button type="button" className="user-avatar-button" aria-label="打开我的资料" onClick={()=>phoneView?actions.openPhoneContact?.('self'):actions.navigate('profile')}><Avatar key={userAvatar} name={userName} src={userAvatar} className="message-avatar self-avatar"/></button>}
    <div className="message-body">
      <div className="message-label" hidden={phoneView}><span>{user ? userName : name}</span>{!phoneView&&message.channel==='phone'&&<span className="message-channel">手机</span>}{message.incomplete&&<span className="reply-phase">{generating?'正在回复':'未完成'}</span>}</div>
      {!user&&!phoneView&&<ReasoningPanel message={message} actions={actions}/>}
      {user ? phoneView&&scoreCard?<div className="phone-score-card"><span>游戏战绩</span><strong>{scoreCard[1]}</strong><b>{scoreCard[2]}<small>分</small></b><footer>{scoreCard[3]} 步 · {scoreCard[4]} 级</footer></div>:sticker?<figure className="user-sticker-message"><StickerArt src={sticker.src} sprite={sticker.sprite} label={`${sticker.label}：${sticker.meaning}`} className="user-sticker-art"/><figcaption>{sticker.label}</figcaption></figure>:<MessageContent text={message.text || ''}/> : <ReplyBubbles phone={phoneView} text={message.text || ''} roleId={roleId} presentation={presentation} streaming={generating} animate={animate} reveal={reveal} onRevealDone={()=>actions.revealCompleted?.(message.id)}/>}
      {!user&&!message.text&&generating&&<div className="reply-waiting"><span className="reply-dots" aria-hidden="true"><i/><i/><i/></span><span className="sr-only">正在等待正文</span></div>}
      {!user&&!phoneView&&notices.length>0&&<details className="partial-disclosure scene-processing-notice"><summary>本条回复的场景处理说明</summary><ul>{notices.map(code=><li key={code}>{SCENE_NOTICES[code as keyof typeof SCENE_NOTICES]}</li>)}</ul></details>}
      {message.incomplete&&!generating&&<p className="partial-disclosure">此片段未进入正式历史，重试会重新生成。</p>}
      {!!message.attachments?.length && <MessageAttachments attachments={message.attachments} resolve={actions.resolveAttachment}/>}
      <div className="message-footer" hidden={phoneView}>
        {validDate && <time dateTime={date!.toISOString()} title={date!.toLocaleString('zh-CN')}>{worldDate&&!Number.isNaN(worldDate.getTime())?worldDate.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',timeZone:'UTC'}):date!.toLocaleTimeString('zh-CN', {hour: '2-digit', minute: '2-digit'})}</time>}
        <CopyButton text={message.text || ''} accessibleLabel={`复制${user ? '你的' : name + '的'}消息`}/>
      </div>
    </div>
  </article>;
}

// The same visual shell covers waiting, streamed text and retained incomplete text.
// Incomplete content stays separate from formal conversation history.
export function ReplyProgress({roleId, name, avatar, busy, partial,chatMode}: Pick<ChatSnapshot, 'roleId'|'name'|'avatar'|'busy'|'partial'|'chatMode'>) {
  if (!busy && !partial?.text) return null;
  const generating = busy && (!partial || partial.status === 'generating');
  const text = partial?.text || '';
  return <article className="message partial-reply" data-sender="role" data-generating={generating} aria-label={generating ? '正在回复' : '未完成的回复'}>
    <Avatar key={avatar} name={name} src={avatar} className="message-avatar"/>
    <div className="message-body">
      <div className="message-label"><span>{name}</span><span className="reply-phase">{generating ? '正在回复' : '未完成'}</span></div>
      {text ? <ReplyBubbles text={text} roleId={roleId} streaming={generating} presentation={chatMode!=='assistant'}/> : <div className="message-content reply-waiting"><span className="reply-dots" aria-hidden="true"><i/><i/><i/></span><span className="sr-only">正在等待模型回复</span></div>}
      {text && <div className="message-footer"><CopyButton text={text} label="复制片段" accessibleLabel="复制未完成回复"/>
        {!generating && <span className="partial-note">{partial?.volatile ? '尚未保存，请先复制' : '未完成片段'}</span>}
      </div>}
      {!generating && <p className="partial-disclosure">此片段未进入正式历史。{partial?.volatile ? '刷新后会丢失。' : '重试会重新生成。'}</p>}
    </div>
  </article>;
}
