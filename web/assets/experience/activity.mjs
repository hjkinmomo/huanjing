export function activityRequest(source,roles,type,id){
  if(!['gift','game','encouragement'].includes(type)||typeof id!=='string')throw Error('活动请求无效。');
  const receipt=type==='gift'?(source.giftLog||[]).find(r=>r.id===id):type==='encouragement'&&source.leisure?.active?.id===id&&source.leisure.active.status==='playing'?source.leisure.active:(source.leisure?.records||[]).find(r=>r.id===id);
  if(type==='encouragement'&&receipt?.status!=='playing')throw Error('这局游戏已结束，请分享结算成绩。');
  if(!receipt)throw Error('这份活动记录已变化，请重新打开。');
  const roleId=type==='gift'?receipt.role:receipt.roleId,role=roles.find(r=>r.id===roleId);if(!role)throw Error('本局角色已不可用，原记录仍保留。');
  if(type!=='gift'&&(!['memory','tiles','puzzle','lights','klotski','flight','snake'].includes(receipt.kind)||!Number.isSafeInteger(receipt.score)||receipt.score<0||!Number.isSafeInteger(receipt.moves)||receipt.moves<0))throw Error('成绩记录格式异常，未提交。');
  const gameName={memory:'记忆花园',tiles:'2048',klotski:'木间华容道',puzzle:'拼图小憩',lights:'熄灯晚安',flight:'星港守卫',snake:'青庭贪吃蛇'}[receipt.kind];
  const text=type==='gift'?`我刚把「${receipt.giftName}」送给你。${receipt.note?`留言是：${receipt.note}。`:''}想听听你的回应。`:type==='encouragement'?`我正在玩${gameName}，第 ${receipt.moves} 步，目前 ${receipt.score} 分。想让你陪我一下，给一点符合你性格的鼓励或简单建议，几句话就好。`:`🎮 游戏战绩\n${gameName} · ${receipt.score} 分\n${receipt.moves} 步 · 评级 ${receipt.grade}\n我刚打完这一局，发给你看看。`;
  return {role,text,preserveDraft:true,activity:{id:type==='encouragement'?`game-progress:${id}:${receipt.moves}`:`${type}:${id}`,type:type==='gift'?'gift':'game'}};
}
