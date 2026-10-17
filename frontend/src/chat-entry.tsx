import {createRef} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {ChatView} from './ChatView';
import {fitComposerTextarea} from './ChatComposer';
import type {ChatActions,ChatSnapshot} from './chat-types';
import {setPresentationPolicy} from '../../web/assets/experience/chat-presentation.mjs';
import {refreshStickerPolicy} from '../../web/assets/experience/sticker-catalog.mjs';

// Temporary migration adapter: only this module owns the chat DOM.
// Domain operations stay in the existing controller until extracted independently.
export function mountChat(host:HTMLElement,actions:ChatActions) {
  const root=createRoot(host),messageRef=createRef<HTMLTextAreaElement>(),messagesRef=createRef<HTMLDivElement>();
  let snapshot:ChatSnapshot={initializing:true,roleId:'',name:'希拉',subtitle:'',portrait:'',avatar:'',greeting:'',messages:[],ready:false,connectionLabel:'正在检查连接',busy:true,sendKey:'enter',bagCount:0,feedback:'',feedbackAction:null};
  function update(patch:Partial<ChatSnapshot>) {
    if(patch.presentation&&patch.presentation!==snapshot.presentation){setPresentationPolicy(patch.presentation);refreshStickerPolicy();}
    snapshot={...snapshot,...patch};
    // Keep legacy navigation's immediate draft/scroll reads synchronous during migration.
    flushSync(()=>root.render(<ChatView snapshot={snapshot} actions={actions} messageRef={messageRef} messagesRef={messagesRef}/>));
  }
  update({});
  return {
    update,
    getDraft:()=>messageRef.current?.value || '',
    isNearBottom:()=>{const n=messagesRef.current;return !!n&&n.dataset.readingPosition===undefined&&n.scrollHeight-n.clientHeight-n.scrollTop<160;},
    setDraft:(value:string)=>{if(messageRef.current){messageRef.current.value=value;fitComposerTextarea(messageRef.current);}},
    getScroll:()=>{const node=messagesRef.current;return Number(node?.dataset.readingPosition ?? node?.scrollTop ?? 0);},
    setScroll:(value?:number)=>{const node=messagesRef.current;if(node)node.scrollTop=value ?? node.scrollHeight;},
    destroy:()=>root.unmount(),
  };
}
