export function RoomMovementReceipt({receipt:r}:{receipt:any}){
 if(r.status==='continued')return null;
 const title=r.status==='arrived'?(r.joint?'你们已到达':'角色已到达'):r.status==='awaiting_user'?'等待确认':r.status==='reading'?'正在核对位置':r.status==='expired'?'这份邀请已结束':'位置没有改变';
 return <aside className="room-movement-receipt" data-status={r.status} aria-label="房间移动结果" role="status"><strong>{title}</strong><span>{r.placeName}</span>{r.status!=='arrived'&&<small>{r.status==='failed'?'判断未完成，可重新提出这次邀请。':r.reason}</small>}</aside>;
}
