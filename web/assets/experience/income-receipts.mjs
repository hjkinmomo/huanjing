export function mergeAutomaticIncome(original,receipts=[],currentRevision=0){
 const state=structuredClone(original),seen=new Set(state.incomeReceiptsSeen||[]),ledger=state.walletLedger||[];
 for(const entry of ledger)if(entry.kind==='automatic-income')seen.add(entry.id);
 const added=[];
 for(const entry of receipts){if(entry?.kind!=='automatic-income'||!String(entry.id).startsWith('auto-income:')||!Number.isSafeInteger(entry.delta)||entry.delta<0||seen.has(entry.id))continue;
  const coins=(state.coins??520)+entry.delta;if(!Number.isSafeInteger(coins)||coins<0)throw Error('收入尚未合并，原余额仍保留。');state.coins=coins;seen.add(entry.id);added.push(entry);
 }
 let revision=currentRevision;for(const entry of [...receipts].sort((a,b)=>(a.baseRevision??-1)-(b.baseRevision??-1))){if(entry.kind==='automatic-income'&&entry.baseRevision===revision&&entry.clientRevision===revision+1)revision=entry.clientRevision;}
 state.incomeReceiptsSeen=[...seen].slice(-5000);state.walletLedger=[...added,...ledger].slice(0,500);return {state,added,revision};
}
