// Anchor a pending change to its actual recipient reply, never a fabricated message.
export function scheduleCards(messages,commitments,messageId){
 return (commitments||[]).filter(c=>{
  if(c.status!=='awaiting_owner')return false;
  if(c.evidence?.messageId)return c.evidence.messageId===messageId;
  const index=messages.findIndex(m=>m.id===c.source?.messageId);
  if(index<0)return false;
  return messages.slice(index+1).find(m=>m.from==='role'&&!m.incomplete)?.id===messageId;
 });
}
