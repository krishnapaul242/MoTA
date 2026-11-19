/**
 * Client script for a single live device screen: H.264 video through WebCodecs with screenshot fallback,
 * and pointer/key/text input. Expects #livecanvas, #liveimg, #livemsg, #livemode, #liveDot and a page `send(action, extra)` and `toast(text, error)`.
 * Host messages: frame, frame-error, video, video-reset, video-failed. Host actions: live-start {stream}, gesture, key, text, video-error, video-unsupported.
 */
import { liveTouchScript } from './liveTouch';

export const liveScreenScript = liveTouchScript + `
let liveDims={};
const liveImg=document.getElementById('liveimg'),liveCanvas=document.getElementById('livecanvas'),liveCtx=liveCanvas.getContext('2d');
let liveDecoder=null,liveCodec='',liveWaitKey=true,liveTs=0,liveErrors=0,liveSupported,liveDown=null;
function liveMode(text,dot){const m=document.getElementById('livemode');if(m)m.textContent=text;const d=document.getElementById('liveDot');if(d)d.className='dot '+(dot||'live');}
function liveVideoSupported(){if(liveSupported!==undefined)return Promise.resolve(liveSupported);if(typeof VideoDecoder!=='function')return Promise.resolve(liveSupported=false);
 return VideoDecoder.isConfigSupported({codec:'avc1.42e01f',optimizeForLatency:true}).then(r=>liveSupported=!!r.supported,()=>liveSupported=false);}
function liveReset(){try{if(liveDecoder&&liveDecoder.state!=='closed')liveDecoder.close();}catch{}liveDecoder=null;liveCodec='';liveWaitKey=true;}
function liveDraw(frame){if(liveCanvas.width!==frame.displayWidth||liveCanvas.height!==frame.displayHeight){liveCanvas.width=frame.displayWidth;liveCanvas.height=frame.displayHeight;}
 liveCtx.drawImage(frame,0,0);frame.close();if(liveCanvas.hidden){liveCanvas.hidden=false;liveImg.hidden=true;document.getElementById('livemsg').hidden=true;liveMode(touchLive.on?'Live · scrcpy':'Live video');}}
function liveFailed(e){liveReset();if(++liveErrors>=3){touchLive.on=false;send('video-unsupported');liveCanvas.hidden=true;liveMode('Screenshot mode','warn');toast('Video decoding failed, so the screen updates from screenshots: '+(e&&e.message||e),true);}else send('video-error');}
function liveBytes(d){return d instanceof Uint8Array?d:d instanceof ArrayBuffer?new Uint8Array(d):ArrayBuffer.isView(d)?new Uint8Array(d.buffer,d.byteOffset,d.byteLength):new Uint8Array(Array.isArray(d)?d:Object.values(d||{}));}
function liveOnVideo(m){if(liveErrors>=3)return;
 if(m.key&&m.codec&&(!liveDecoder||liveCodec!==m.codec)){liveReset();
  try{liveDecoder=new VideoDecoder({output:liveDraw,error:liveFailed});liveDecoder.configure({codec:m.codec,optimizeForLatency:true});liveCodec=m.codec;}catch(e){liveFailed(e);return;}}
 if(!liveDecoder||(liveWaitKey&&!m.key))return;liveWaitKey=false;
 try{liveDecoder.decode(new EncodedVideoChunk({type:m.key?'key':'delta',timestamp:(liveTs++)*33333,data:liveBytes(m.data)}));}catch(e){liveFailed(e);}}
function liveMessage(m){
 if(m.kind==='frame'){if(liveCanvas.hidden){liveImg.src=m.src;liveImg.hidden=false;document.getElementById('livemsg').hidden=true;liveMode(liveSupported?'Live · waiting for video':'Live · screenshots',liveSupported?'live':'ready');}return true;}
 if(m.kind==='frame-error'){if(liveImg.hidden&&liveCanvas.hidden)document.getElementById('livemsg').textContent=m.text;return true;}
 if(m.kind==='video'){liveOnVideo(m);return true;}
 if(m.kind==='video-reset'){if(m.session)liveReset();else liveWaitKey=true;return true;}
 if(m.kind==='live-mode'){touchLive.on=m.engine==='scrcpy';if(!liveCanvas.hidden)liveMode(touchLive.on?'Live · scrcpy':'Live video');if(m.note)toast(m.note,true);return true;}
 if(m.kind==='video-failed'){touchLive.on=false;liveReset();liveCanvas.hidden=true;liveMode('Screenshot mode','warn');toast('Live video stopped: '+m.text,true);return true;}
 return false;}
function liveInfo(i){liveDims=i||{};}
function liveStart(){touchLive.on=false;liveVideoSupported().then(ok=>{liveMode(ok?'Connecting…':'Screenshot mode',ok?'live':'warn');send('live-start',{stream:ok});});}
function liveSurface(){if(!liveCanvas.hidden&&liveCanvas.width){let w=liveDims.width||liveCanvas.width,hh=liveDims.height||liveCanvas.height;
  if((liveCanvas.width>liveCanvas.height)!==(w>hh))[w,hh]=[hh,w];return{el:liveCanvas,w,h:hh};}
 return liveImg.naturalWidth&&!liveImg.hidden?{el:liveImg,w:liveImg.naturalWidth,h:liveImg.naturalHeight}:null;}
const livePoint=(e,s)=>{const r=s.el.getBoundingClientRect();return{x:Math.round((e.clientX-r.left)*s.w/r.width),y:Math.round((e.clientY-r.top)*s.h/r.height),cx:e.clientX,cy:e.clientY};};
for(const el of [liveImg,liveCanvas]){
 el.addEventListener('pointerdown',e=>{const s=liveSurface();if(!s||s.el!==el)return;el.setPointerCapture(e.pointerId);liveDown={...livePoint(e,s),t:performance.now(),s};e.preventDefault();});
 el.addEventListener('pointerup',e=>{if(!liveDown)return;const s=liveDown.s,p=livePoint(e,s),c=(v,m)=>Math.max(0,Math.min(m-1,v));
  const x=c(liveDown.x,s.w),y=c(liveDown.y,s.h),x2=c(p.x,s.w),y2=c(p.y,s.h);
  if(Math.hypot(p.cx-liveDown.cx,p.cy-liveDown.cy)<8)send('gesture',{type:'tap',x,y});else send('gesture',{type:'swipe',x,y,x2,y2,duration:performance.now()-liveDown.t});liveDown=null;});
 el.addEventListener('pointercancel',()=>{liveDown=null;});}
touchAttach([liveImg,liveCanvas],m=>send(m.action,m));
function liveKey(key){send('key',{key});}
function liveText(text){send('text',{text});}
`;
