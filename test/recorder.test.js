const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,readFile,writeFile,mkdir,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const net=require('node:net');
const {InputDecoder,touchDevices}=require('../out/inputEvents');
const {validateSession,assertReplay,RecordingStore,downloadSession}=require('../out/recorder');
const {HelperClient,parseBootstrap}=require('../out/helperClient');
const touch={path:'/dev/input/event2',name:'touch',xMin:0,xMax:1000,yMin:0,yMax:2000};
const display={width:101,height:201,rotation:0};
const fixture=`add device 1: /dev/input/event2
  name: "touch"
  ABS_MT_SLOT : value 0, min 0, max 9, fuzz 0
  ABS_MT_TRACKING_ID : value 0, min 0, max 65535
  ABS_MT_POSITION_X : value 0, min 0, max 1000, fuzz 0
  ABS_MT_POSITION_Y : value 0, min 0, max 2000, fuzz 0
add device 2: /dev/input/event3
  name: "keyboard"
`;
function emit(decoder,time,code,value,type=code.startsWith('SYN')?'EV_SYN':code.startsWith('KEY')?'EV_KEY':'EV_ABS'){
 decoder.line(`[ ${time.toFixed(6)}] /dev/input/event2: ${type} ${code} ${value}`);
}
function gesture(){return {type:'gesture',atMs:0,delayMs:0,...display,dispatch:'completed',strokes:[{pointerId:0,startMs:0,durationMs:100,points:[[10,20,0],[10,20,100]]}]};}
function data(){return {schemaVersion:1,...display,actions:[gesture()]};}
const meta={id:'id',name:'test',device:'old-address',identity:'same-phone',model:'Phone',createdAt:'2026-01-01',mode:'adb',complete:true};
test('probe detects calibrated protocol A and B multitouch devices',()=>{
 assert.deepEqual(touchDevices(fixture),[touch]);
 assert.deepEqual(touchDevices(fixture.replace('ABS_MT_SLOT','ABS_X')),[{...touch,protocol:'a'}]);
 assert.deepEqual(touchDevices('Permission denied'),[]);
});
test('decoder retains two-finger timing, scales raw axes, and ends only after all fingers lift',()=>{
 const actions=[],d=new InputDecoder(touch,display,1000,a=>actions.push(a));
 emit(d,1.1,'ABS_MT_TRACKING_ID','00000001');emit(d,1.1,'ABS_MT_POSITION_X','000001f4');emit(d,1.1,'ABS_MT_POSITION_Y','000003e8');emit(d,1.1,'SYN_REPORT','00000000');
 emit(d,1.15,'ABS_MT_SLOT','00000001');emit(d,1.15,'ABS_MT_TRACKING_ID','00000002');emit(d,1.15,'ABS_MT_POSITION_X','000003e8');emit(d,1.15,'ABS_MT_POSITION_Y','000007d0');emit(d,1.15,'SYN_REPORT','00000000');
 emit(d,1.25,'ABS_MT_SLOT','00000000');emit(d,1.25,'ABS_MT_TRACKING_ID','ffffffff');emit(d,1.25,'SYN_REPORT','00000000');assert.equal(actions.length,0);
 emit(d,1.3,'ABS_MT_SLOT','00000001');emit(d,1.3,'ABS_MT_TRACKING_ID','ffffffff');emit(d,1.3,'SYN_REPORT','00000000');
 assert.equal(actions.length,1);assert.equal(actions[0].atMs,100);assert.equal(actions[0].strokes.length,2);
 assert.deepEqual(actions[0].strokes[0].points[0],[50,100,0]);assert.equal(actions[0].strokes[1].startMs,50);
 assert.equal(actions[0].strokes[0].durationMs,150);assert.equal(actions[0].strokes[1].durationMs,150);assert.equal(d.incomplete,false);
 validateSession({schemaVersion:1,...display,actions});
});
test('decoder rejects dropped events, unsupported rotation and permission failures',()=>{
 assert.throws(()=>new InputDecoder(touch,{...display,rotation:1},0,()=>{}),/natural/);
 const d=new InputDecoder(touch,display,0,()=>{});assert.throws(()=>d.line('could not open /dev/input/event2: Permission denied'),/denied/);
 assert.throws(()=>emit(d,1,'SYN_DROPPED','00000000'),/dropped/);
});
test('session validation rejects unfinished, oversized, injected paths and unsupported actions',()=>{
 assert.equal(validateSession(data()).actions.length,1);
 for(const modify of [d=>d.actions[0].dispatch='cancelled',d=>d.actions[0].strokes[0].points[0][0]=NaN,d=>d.actions[0].delayMs=-1,d=>d.actions[0].strokes[0].durationMs=999999,d=>d.actions[0].type='shell',d=>d.screenshots=[{file:'../../secret',atMs:0,actionIndex:0}]]){const d=data();modify(d);assert.throws(()=>validateSession(d));}
});
test('replay accepts reconnecting addresses but rejects other identities, incomplete sessions and display changes',()=>{
 const record={dir:'/tmp',meta,data:data()};assert.doesNotThrow(()=>assertReplay(record,{serial:'new-address'},'same-phone',display));
 assert.throws(()=>assertReplay(record,{},'other',display),/restricted/);
 assert.throws(()=>assertReplay(record,{},'same-phone',{...display,rotation:1}),/orientation/);
 assert.throws(()=>assertReplay({...record,meta:{...meta,complete:false}}, {},'same-phone',display),/incomplete/);
});
test('bridge bootstrap rejects missing credentials and incompatible versions',()=>{
 assert.throws(()=>parseBootstrap('SecurityException'),/bridge unavailable/);
 const payload={protocol:1,version:'0.3.0',socket:'mota.recorder',token:'x'.repeat(44),ready:true};
 assert.equal(parseBootstrap('Row: 0 bridge='+Buffer.from(JSON.stringify(payload)).toString('base64')).ready,true);
 assert.throws(()=>parseBootstrap('bridge='+Buffer.from(JSON.stringify({...payload,version:'9'})).toString('base64')),/mismatch/);
});
test('helper client correlates replies and removes only its allocated forward',async()=>{
 const requests=[],calls=[];const server=net.createServer(socket=>{let buffer='';socket.on('data',chunk=>{buffer+=chunk;if(buffer.includes('\n')){const request=JSON.parse(buffer);requests.push(request);socket.end(JSON.stringify({id:request.id,result:{protocol:1,version:'0.3.0',ready:true}})+'\n');}});});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
 const bootstrap={protocol:1,version:'0.3.0',socket:'mota.recorder',token:'x'.repeat(44),ready:true};
 const adb={shell:async()=> 'Row: 0 bridge='+Buffer.from(JSON.stringify(bootstrap)).toString('base64'),run:async args=>{calls.push(args);return String(port);}};
 const client=new HelperClient(adb,'phone');try{assert.equal((await client.connect()).ready,true);await client.request('stop');assert.deepEqual(requests.map(r=>r.op),['status','stop']);assert.ok(requests.every(r=>r.token===bootstrap.token));}finally{await client.dispose();await new Promise(r=>server.close(r));}
 assert.deepEqual(calls.at(-1),['-s','phone','forward','--remove',`tcp:${port}`]);assert.ok(calls.every(c=>!c.includes(bootstrap.token)));
});
test('ZIP import enforces paths, binds legacy helper sessions and retains MoTA device binding',async()=>{
 const yazl=require('yazl');const root=await mkdtemp(join(tmpdir(),'mota-test-'));
 async function zip(name,files){const file=join(root,name),z=new yazl.ZipFile();for(const [n,b]of files)z.addBuffer(Buffer.from(b),n);z.end();await require('node:stream/promises').pipeline(z.outputStream,require('node:fs').createWriteStream(file));return file;}
 try{
 const store=new RecordingStore(join(root,'sessions'));const bound={...meta};delete bound.id;delete bound.createdAt;
 const good=await zip('good.zip',[['actions.json',JSON.stringify(data())],['screenshots/0001.png','png']]);
 const record=await store.importZip(good,bound);assert.equal(record.meta.complete,true);assert.equal((await store.list()).length,1);
 const other=await zip('other.zip',[['actions.json',JSON.stringify(data())],['session.json',JSON.stringify({...meta,identity:'another'})]]);await assert.rejects(store.importZip(other,bound),/another device/);
 const bad=await zip('bad.zip',[['unexpected.txt','secret'],['actions.json',JSON.stringify(data())]]);await assert.rejects(store.importZip(bad,bound),/unsafe path/);
 assert.equal((await store.list()).length,1);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('helper downloads are chunked and reject traversal before writing',async()=>{
 const root=await mkdtemp(join(tmpdir(),'mota-download-'));try{
 const content=Buffer.from(JSON.stringify(data()));let reads=0;
 const client={request:async(op,p)=>op==='files'?{files:[{path:'actions.json',size:content.length}]}:(reads++,{data:content.subarray(p.offset,p.offset+25).toString('base64')})};
 await downloadSession(client,'id',root);assert.ok(reads>1);assert.deepEqual(JSON.parse(await readFile(join(root,'actions.json'),'utf8')),data());
 await assert.rejects(downloadSession({request:async()=>({files:[{path:'../secret',size:1}]})},'id',root),/Invalid/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('raw recording drains checkpoint writes before stopping and marks empty or interrupted input incomplete',async()=>{
 const {RawRecording}=require('../out/recorder');const {PassThrough}=require('node:stream');const {EventEmitter}=require('node:events');
 const root=await mkdtemp(join(tmpdir(),'mota-raw-'));try{
 for(const interrupted of [false,true,'empty']){
 const store=new RecordingStore(join(root,String(interrupted))),staged=await store.create({...meta,complete:false});
 const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{child.emit('close',0);return true;};
 const calls=[];const client={serial:'phone',request:async(op)=>{calls.push(op);return {protocol:1,version:'0.3.0',ready:true,recording:op!=='stop',session:'test',uptimeStartMs:1000,...display};}};
 const raw=new RawRecording({stream:()=>child},client,display,touch,staged.dir,staged.meta,()=>{});await raw.start();
 const line=(at,code,value)=>child.stdout.write(`[ ${at}] /dev/input/event2: ${code.startsWith('SYN')?'EV_SYN':'EV_ABS'} ${code} ${value}\n`);
 if(interrupted!=='empty'){line('1.100000','ABS_MT_TRACKING_ID','00000001');line('1.100000','ABS_MT_POSITION_X','000001f4');line('1.100000','ABS_MT_POSITION_Y','000003e8');line('1.100000','SYN_REPORT','00000000');}
 if(!interrupted){line('1.200000','ABS_MT_TRACKING_ID','ffffffff');line('1.200000','SYN_REPORT','00000000');}
 await raw.stop();await raw.stop();
 assert.equal(calls.filter(c=>c==='stop').length,1);const saved=JSON.parse(await readFile(join(staged.dir,'session.json'),'utf8'));assert.equal(saved.complete,!interrupted);
 const actions=JSON.parse(await readFile(join(staged.dir,'actions.json'),'utf8'));assert.equal(actions.actions.length,interrupted?0:1);if(interrupted===true)assert.match(saved.error,/finger/);if(interrupted==='empty')assert.match(saved.error,/No touch.*0 event lines/);
 }
 }finally{await rm(root,{recursive:true,force:true});}
});

test('decoder automatically selects the active device rather than the first emulator input',()=>{
 const actions=[],inactive={...touch,path:'/dev/input/event11',name:'inactive'};const d=new InputDecoder([inactive,touch],display,1000,a=>actions.push(a));
 emit(d,1.1,'ABS_MT_SLOT','00000003');emit(d,1.1,'ABS_MT_POSITION_X','000001f4');emit(d,1.1,'ABS_MT_POSITION_Y','000003e8');emit(d,1.1,'ABS_MT_TRACKING_ID','00000007');emit(d,1.1,'SYN_REPORT','00000000');
 emit(d,1.2,'ABS_MT_TRACKING_ID','ffffffff');emit(d,1.2,'SYN_REPORT','00000000');
 assert.equal(d.activeDevice.path,touch.path);assert.equal(actions.length,1);assert.equal(actions[0].strokes[0].pointerId,3);assert.deepEqual(actions[0].strokes[0].points[0],[50,100,0]);
});
test('protocol A records contact frames, holds and complete release without slots',()=>{
 const actions=[],d=new InputDecoder({...touch,protocol:'a'},display,1000,a=>actions.push(a));
 const contact=(at,id,x,y)=>{emit(d,at,'ABS_MT_TRACKING_ID',id);emit(d,at,'ABS_MT_POSITION_X',x);emit(d,at,'ABS_MT_POSITION_Y',y);emit(d,at,'SYN_MT_REPORT','00000000');};
 contact(1.1,'00000000','000001f4','000003e8');emit(d,1.1,'SYN_REPORT','00000000');
 contact(1.2,'00000000','000001f4','000003e8');contact(1.2,'00000001','000003e8','000007d0');emit(d,1.2,'SYN_REPORT','00000000');
 contact(1.4,'00000001','00000300','00000700');emit(d,1.4,'SYN_REPORT','00000000');assert.equal(actions.length,0);
 emit(d,1.8,'BTN_TOUCH','UP','EV_KEY');emit(d,1.8,'SYN_MT_REPORT','00000000');emit(d,1.8,'SYN_REPORT','00000000');
 assert.equal(actions.length,1);assert.equal(actions[0].strokes.length,2);assert.equal(actions[0].strokes[0].durationMs,300);assert.equal(actions[0].strokes[1].startMs,100);assert.equal(actions[0].strokes[1].durationMs,600);validateSession({schemaVersion:1,...display,actions});
});
test('event parsing tolerates CRLF and trailing whitespace from adb',()=>{
 const actions=[],d=new InputDecoder(touch,display,1000,a=>actions.push(a));
 for(const [time,code,value]of [[1.1,'ABS_MT_TRACKING_ID','00000001'],[1.1,'ABS_MT_POSITION_X','00000020'],[1.1,'ABS_MT_POSITION_Y','00000020'],[1.1,'SYN_REPORT','00000000'],[1.2,'ABS_MT_TRACKING_ID','ffffffff'],[1.2,'SYN_REPORT','00000000']])d.line(`[ ${time.toFixed(6)}] ${touch.path}: ${code.startsWith('SYN')?'EV_SYN':'EV_ABS'} ${code} ${value}   \r`);
 assert.equal(actions.length,1);
});
