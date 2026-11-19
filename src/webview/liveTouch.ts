/**
 * Client script: live touch for a scrcpy stream. While `touchLive.on`, pointer events on the given elements are
 * sent as they happen (down / move per animation frame / up) as fractions of the element, plus wheel scrolling,
 * and the page's own tap/swipe handlers are skipped. `post(msg)` adds the serial and posts to the host.
 * Host actions: touch {type, x, y, id}, scroll {x, y, h, v}.
 */
export const liveTouchScript = `
const touchLive={on:false};
function touchAttach(els,post){
 const active=new Set(),pending=new Map();let raf=0;
 const frac=(e,el)=>{const r=el.getBoundingClientRect();return{x:(e.clientX-r.left)/r.width,y:(e.clientY-r.top)/r.height};};
 const pid=e=>e.pointerType==='touch'?e.pointerId:-2;
 const flush=()=>{raf=0;for(const m of pending.values())post(m);pending.clear();};
 for(const el of els){
  el.addEventListener('pointerdown',e=>{if(!touchLive.on||el.hidden||e.button>0)return;e.stopImmediatePropagation();e.preventDefault();el.setPointerCapture(e.pointerId);active.add(e.pointerId);post({action:'touch',type:'down',id:pid(e),...frac(e,el)});},{capture:true});
  el.addEventListener('pointermove',e=>{if(!active.has(e.pointerId))return;e.stopImmediatePropagation();pending.set(e.pointerId,{action:'touch',type:'move',id:pid(e),...frac(e,el)});if(!raf)raf=requestAnimationFrame(flush);},{capture:true});
  const end=e=>{if(!active.has(e.pointerId))return;e.stopImmediatePropagation();active.delete(e.pointerId);const m=pending.get(e.pointerId);if(m){pending.delete(e.pointerId);post(m);}post({action:'touch',type:'up',id:pid(e),...frac(e,el)});};
  el.addEventListener('pointerup',end,{capture:true});el.addEventListener('pointercancel',end,{capture:true});
  el.addEventListener('wheel',e=>{if(!touchLive.on||el.hidden)return;e.preventDefault();const k=e.deltaMode===1?1/3:1/100;post({action:'scroll',...frac(e,el),h:-e.deltaX*k,v:-e.deltaY*k});},{capture:true,passive:false});
  el.addEventListener('contextmenu',e=>{if(touchLive.on)e.preventDefault();});
 }}
`;
