// A deliberate horizontal pull or flick turns a card. Short tilts, vertical
// gestures, cancellation and a second pointer never change the visible face.
export function createCardGesture(){
 let start=null,samples=[];
 return {
  begin(id,x,y,time,width){if(start)return false;start={id,x,y,time,width:Math.max(1,width)};samples=[{x,time}];return true;},
  move(id,x,y,time){if(!start||start.id!==id)return null;samples.push({x,time});samples=samples.filter(s=>time-s.time<=100);return {dx:x-start.x,dy:y-start.y,width:start.width};},
  end(id,x,y,time,cancel=false){
   if(!start||start.id!==id)return {flip:false};
   const dx=x-start.x,dy=y-start.y,age=time-start.time;
   const recent=samples.find(s=>time-s.time>=12)||samples[0];
   const velocity=recent&&time-recent.time>0?(x-recent.x)/(time-recent.time):0;
   const horizontal=Math.abs(dx)>Math.abs(dy)*1.4;
   const pull=Math.abs(dx)>=Math.min(150,Math.max(80,start.width*.36));
   const flick=age<700&&Math.abs(dx)>=45&&Math.abs(velocity)>=.85&&Math.sign(velocity)===Math.sign(dx);
   start=null;samples=[];return {flip:!cancel&&horizontal&&(pull||flick),direction:dx<0?-1:1,dx,dy,velocity};
  },
  cancel(){start=null;samples=[];},
 };
}
