export const FX_PALETTES=Object.freeze([
 {id:'theme',label:'跟随主题'}, {id:'ice',label:'冰蓝'}, {id:'rose',label:'玫粉'},
 {id:'gold',label:'鎏金'}, {id:'violet',label:'星紫'}, {id:'multi',label:'多彩'},
 {id:'rainbow',label:'彩虹'}, {id:'custom',label:'自选色'}
]);
const presets=Object.freeze({ice:['#42cbea','#42cbea','#42cbea'],rose:['#f17bb8','#f17bb8','#f17bb8'],gold:['#dcb450','#dcb450','#dcb450'],violet:['#a78bfa','#a78bfa','#a78bfa'],multi:['#54d9da','#bba0ff','#ff8db6'],rainbow:['#ff6d95','#56d6df','#d5a2ff']});
export const validFxColor=value=>typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value);
export function normalizeCardFx(value={}){
 return {palette:FX_PALETTES.some(p=>p.id===value?.palette)?value.palette:'multi',color:validFxColor(value?.color)?value.color.toLowerCase():'#73d9ed',dragEffects:value?.dragEffects!==false};
}
export function fxColors(value,themeColor='#8b7361'){
 const pref=normalizeCardFx(value),single=pref.palette==='custom'?pref.color:validFxColor(themeColor)?themeColor:'#8b7361';
 return presets[pref.palette]||[single,single,single];
}
export function changeCardFx(state,role,patch){
 if(!patch||typeof patch!=='object'||Array.isArray(patch)||Object.keys(patch).some(k=>!['palette','color','dragEffects'].includes(k)))throw Error('光效设置无效。');
 if('palette' in patch&&!FX_PALETTES.some(p=>p.id===patch.palette))throw Error('光效配色无效。');
 if('color' in patch&&!validFxColor(patch.color))throw Error('请选择有效颜色。');
 if('dragEffects' in patch&&typeof patch.dragEffects!=='boolean')throw Error('拖动光效选项无效。');
 const value=normalizeCardFx({...state.display?.[role.id]?.cardFx,...patch});
 state.display||={};state.display[role.id]={...state.display[role.id],cardFx:value};
}
export function selectedCardFx(state,role){return normalizeCardFx(state.display?.[role.id]?.cardFx);}
export function createFxMotion(){
 let energy=0,direction=0,last=0;
 return {step(dt,tilt,dragging,reduced=false){
  dt=Math.min(.1,Math.max(.001,Number(dt)||.016));tilt=Math.min(1,Math.max(-1,Number(tilt)||0));
  if(reduced){energy=0;direction=0;last=tilt;return {energy,direction};}
  const velocity=Math.min(6,Math.abs(tilt-last)/dt);last=tilt;
  const gain=dragging?Math.min(1,.3+Math.abs(tilt)*.8+velocity*.1):0;
  energy=Math.max(gain,energy*Math.exp(-dt*5));if(energy<.002)energy=0;
  direction+=(tilt-direction)*(1-Math.exp(-dt*10));if(Math.abs(direction)<.002)direction=0;
  return {energy,direction};
 },clear(){energy=0;direction=0;last=0;},snapshot(){return {energy,direction};}};
}
