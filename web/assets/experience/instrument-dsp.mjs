// Retain the original attack and crossfade only the stable sustain region.
export function sustainBuffer(context,original){
 const rate=original.sampleRate;
 if(original.duration<.65)return {buffer:original,loop:false};
 const start=Math.floor(Math.min(.45,original.duration*.18)*rate);
 const end=Math.floor(Math.min(start/rate+1.15,original.duration*.78)*rate);
 const cross=Math.min(Math.floor(.075*rate),Math.floor((end-start)/5));
 const buffer=context.createBuffer(original.numberOfChannels,end-cross,rate);
 for(let channel=0;channel<original.numberOfChannels;channel++){
  const input=original.getChannelData(channel),output=buffer.getChannelData(channel);
  output.set(input.subarray(0,end-cross));
  for(let i=0;i<cross;i++){const blend=i/cross;output[end-2*cross+i]=input[end-2*cross+i]*(1-blend)+input[start-cross+i]*blend;}
 }
 return {buffer,loop:true,loopStart:start/rate,loopEnd:(end-cross)/rate};
}
export function roomImpulse(context,seconds=1.65){
 const rate=context.sampleRate,frames=Math.ceil(rate*seconds),buffer=context.createBuffer(2,frames,rate);let seed=137;
 for(let channel=0;channel<2;channel++){
  const data=buffer.getChannelData(channel);let low=0;
  for(let i=0;i<frames;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const noise=seed/2147483648-1;low=.58*low+.42*noise;data[i]=i<rate*.022?0:low*Math.exp(-7*i/frames)*.08;}
  for(const [time,amplitude] of [[.031,.5],[.049,.3],[.079,.2],[.113,.12]])data[Math.round((time+channel*.003)*rate)]+=amplitude;
 }
 return buffer;
}
export function sampleLevel(buffer){let peak=0,sum=0,count=0;const data=buffer.getChannelData(0),start=Math.min(Math.floor(buffer.sampleRate*.05),data.length-1),end=Math.min(data.length,start+buffer.sampleRate);
 for(let i=start;i<end;i++){peak=Math.max(peak,Math.abs(data[i]));sum+=data[i]*data[i];count++;}
 return Math.min(1.8,.18/Math.max(.03,Math.sqrt(sum/Math.max(1,count))),.8/Math.max(.01,peak));
}
