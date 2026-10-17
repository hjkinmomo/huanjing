export function worldDaylight(worldUtc,offsetMinutes=480){
 const d=new Date(Date.parse(worldUtc)+offsetMinutes*60000),hour=Number.isFinite(d.getTime())?d.getUTCHours()+d.getUTCMinutes()/60:12;
 const sun=Math.sin((hour-6)/12*Math.PI),day=hour>=6&&hour<18;
 return {hour,day,elevation:sun,brightness:.18+.82*Math.max(0,sun),label:hour<6?'深夜':hour<9?'清晨':hour<17?'白昼':hour<19?'暮色':'夜晚',clock:`${String(Math.floor(hour)).padStart(2,'0')}:${String(Math.round((hour%1)*60)).padStart(2,'0')}`};
}
