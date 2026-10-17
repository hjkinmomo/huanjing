import {roleMode} from './persona-modes.mjs';
import {readMoments} from './moments-core.mjs';
export const momentFingerprint=p=>JSON.stringify({id:p.id,roleId:p.roleId,author:p.author,text:p.text,image:p.image||'',at:p.at,origin:p.origin,liked:p.liked,comments:p.comments});
const samePost=(a,b)=>['id','roleId','author','text','origin'].every(k=>a[k]===b[k])&&(a.image||'')===(b.image||'')&&Date.parse(a.at)===Date.parse(b.at);
export function createMomentsSync({api,read,mutate,onStatus=()=>{},onChange=()=>{}}){
 let busy=false,again=false,version=null;const observed=new Set();try{for(const post of readMoments(read()).posts)for(const comment of post.comments)if(comment.author==='role')observed.add(comment.id);}catch{}
 const persist=fn=>{mutate(fn);onChange();};
 async function flush(){
  again=true;if(busy)return;busy=true;
  try{do{again=false;const remote=await api.tool('social_feed_list',{}),deleted=new Set(remote.deletedIds||[]);
   if(!Array.isArray(remote.posts)||remote.posts.some(p=>!p))throw Error('本机动态响应不完整');
   const bank=api.personaMode||'normal',fresh=remote.posts?.filter(p=>roleMode(p.roleId)===bank).flatMap(p=>(p.comments||[]).filter(c=>c.author==='role'&&!observed.has(c.id)))||[];
   for(const post of remote.posts||[])for(const c of post.comments||[])if(c.author==='role')observed.add(c.id);
   if(fresh.length&&typeof window!=='undefined'){window.dispatchEvent(new CustomEvent('huanjing:notification',{detail:{kind:'moments'}}));window.dispatchEvent(new CustomEvent('huanjing:moments-unread',{detail:{mode:bank}}));}
   persist(s=>{const local=readMoments(s),posts=local.posts.filter(p=>!deleted.has(p.id));for(const server of remote.posts){
    const deletion=(local.pendingDeletes||[]).find(d=>d.id===server.id);
    if(deletion){if(deletion.runtimeRevision===0)deletion.runtimeRevision=server.runtimeRevision;continue;}
    const index=posts.findIndex(p=>p.id===server.id),old=posts[index];
    if(!old||old.needsSync===false){const hydrated={...server,needsSync:false};if(index<0)posts.push(hydrated);else posts[index]=hydrated;}
    else if(samePost(old,server)){old.runtimeRevision=server.runtimeRevision;old.comments=[...new Map([...server.comments,...old.comments].map(c=>[c.id,c])).values()].sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));}
   }s.moments={...local,posts:posts.sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)),pendingDeletes:(local.pendingDeletes||[]).filter(d=>!deleted.has(d.id))};});
   for(const deletion of readMoments(read()).pendingDeletes||[]){await api.tool('social_feed_delete',deletion);persist(s=>{const m=readMoments(s);s.moments={...m,pendingDeletes:(m.pendingDeletes||[]).filter(d=>d.id!==deletion.id)};});}
   for(const snapshot of readMoments(read()).posts){const fingerprint=momentFingerprint(snapshot);if(snapshot.needsSync===false)continue;
    const {needsSync,...payload}=snapshot;const {post}=await api.tool('social_feed_save',{post:payload});if(!post)throw Error('本机未确认动态保存');
    persist(s=>{const m=readMoments(s),current=m.posts.find(p=>p.id===snapshot.id);
     if(current){if(momentFingerprint(current)===fingerprint)Object.assign(current,post,{needsSync:false});else{current.runtimeRevision=post.runtimeRevision;again=true;}}
     else{const deletion=(m.pendingDeletes||[]).find(d=>d.id===snapshot.id);if(deletion){deletion.runtimeRevision=post.runtimeRevision;again=true;}}
     s.moments=m;
    });
   }onStatus('动态已同步到本机数据库。浏览器重载后可恢复。');
  }while(again);
  }catch(error){onStatus(`仍保留在浏览器，未完成本机同步：${error.message}。可点击“同步本机动态”重试。`);}
  finally{busy=false;}
 }
 async function poll(){if(busy)return;try{const next=await api.tool('social_feed_status',{mode:api.personaMode||'normal'});if(next.version!==version){version=next.version;await flush();}}catch{ /* Existing content stays visible; explicit sync reports errors. */ }}
 return {flush,poll,get busy(){return busy;}};
}
