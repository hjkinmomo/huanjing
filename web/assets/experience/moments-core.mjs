const record=v=>v&&typeof v==='object'&&!Array.isArray(v);
const validId=v=>typeof v==='string'&&/^[-\w:.]{1,100}$/.test(v)&&!['__proto__','constructor','prototype'].includes(v);
export function readMoments(state){
 const v=state.moments;
 if(v===undefined)return {version:1,posts:[],draft:''};
 if(!record(v)||v.version!==1||!Array.isArray(v.posts)||v.posts.some(p=>!record(p)||!validId(p.id)||!validId(p.roleId)||!['user','role'].includes(p.author)||typeof p.text!=='string'||!Number.isFinite(Date.parse(p.at))||(p.runtimeRevision!==undefined&&(!Number.isInteger(p.runtimeRevision)||p.runtimeRevision<0))||(p.needsSync!==undefined&&typeof p.needsSync!=='boolean')||!Array.isArray(p.comments)||p.comments.some(c=>!record(c)||!validId(c.id)||typeof c.text!=='string'||!['user','role'].includes(c.author)))||(v.pendingDeletes!==undefined&&(!Array.isArray(v.pendingDeletes)||v.pendingDeletes.some(d=>!record(d)||!validId(d.id)||!Number.isInteger(d.runtimeRevision)||d.runtimeRevision<0))))throw Error('朋友圈资料格式异常，原内容未覆盖。');
 return v;
}
export function addMoment(state,{id,roleId,author='user',text,image='',at,origin='user'}){
 const data=readMoments(state);
 if(!validId(id)||!validId(roleId)||!['user','role'].includes(author)||typeof text!=='string'||!text.trim()||text.length>2000||!Number.isFinite(Date.parse(at))||!['user','model-fiction'].includes(origin))throw Error('请填写 1–2000 字的动态。');
 if(data.posts.some(p=>p.id===id))return;
 if(data.posts.length>=300)throw Error('已保存 300 条动态，请先导出并整理旧动态。');
 if(image&&!['bunny','lighthouse','cottage','garden','rose','sun','ink'].includes(image))throw Error('配图无效。');
 state.moments={...data,posts:[{id,roleId,author,text:text.trim(),image,at,origin,liked:false,needsSync:true,comments:[]},...data.posts]};
}
export function changeMoment(state,id,action){
 const data=readMoments(state),post=data.posts.find(p=>p.id===id);if(!post)throw Error('这条动态已被移除。');
 if(action.type==='delete'){state.moments={...data,posts:data.posts.filter(p=>p.id!==id),pendingDeletes:[...(data.pendingDeletes||[]).filter(d=>d.id!==id),{id,runtimeRevision:post.runtimeRevision||0}]};if(state.moments.commentDrafts)delete state.moments.commentDrafts[id];return;}
 if(action.type==='like')post.liked=!post.liked;
 else if(action.type==='comment'){
  if(!validId(action.id)||typeof action.text!=='string'||!action.text.trim()||action.text.length>1000||!['user','role'].includes(action.author)||!Number.isFinite(Date.parse(action.at)))throw Error('评论内容或格式无效。');
  if(post.comments.some(c=>c.id===action.id))return;
  if(post.comments.length>=100)throw Error('这条动态的评论已达 100 条。');
  post.comments.push({id:action.id,text:action.text.trim(),author:action.author,at:action.at,...(action.roleId?{roleId:action.roleId}:{}),...(action.replyTo?{replyTo:action.replyTo}:{}),...(action.targetRoleId?{targetRoleId:action.targetRoleId}:{})});
 }else throw Error('动态操作无效。');
 post.needsSync=true;state.moments=data;
}
