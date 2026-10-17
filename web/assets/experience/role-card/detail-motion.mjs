// Local source-registered relief: each region has its own height and response.
export const DETAIL_IDS=Object.freeze(["inner", "outerLeft", "outerRight", "collar", "waist", "trim", "foldLeft", "foldRight", "hem", "brooch", "ribbon", "embroidery"]);
export function createDetailMotion(layers=[]){
 const state=DETAIL_IDS.map(id=>{const p=layers.find(x=>x.id===id);return {id,x:0,y:0,gain:Math.max(0,Math.min(1.5,p?.gain??0)),rate:Math.max(4,Math.min(18,p?.rate??10)),depth:Math.max(-.12,Math.min(.16,p?.depth??0)),active:!!p};});
 return {clear(){state.forEach(p=>p.x=p.y=0);},step(dt,x,y,reduced=false){let moving=false;for(const p of state){const tx=reduced?0:(Math.abs(Math.sin(y))<.000001?0:Math.sin(y))*.002*p.gain,ty=reduced?0:(Math.abs(Math.sin(x))<.000001?0:Math.sin(x))*.0015*p.gain;
  const ease=reduced?1:1-Math.exp(-Math.max(0,Math.min(.1,dt))*p.rate);p.x+=(tx-p.x)*ease;p.y+=(ty-p.y)*ease;if(Math.abs(p.x-tx)<.00002)p.x=tx;if(Math.abs(p.y-ty)<.00002)p.y=ty;moving||=p.x!==tx||p.y!==ty;}return moving;},snapshot:()=>state.map(p=>({...p}))};
}
