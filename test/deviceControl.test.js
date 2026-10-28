const {test}=require('node:test');const assert=require('node:assert/strict');const {EventEmitter}=require('node:events');const {PassThrough}=require('node:stream');
const {deepLinkArgs,shellLiteral,shellQuote,splitArguments,deviceAdbArgs,validatePng,captureScreenshot}=require('../out/deviceControl');const {Adb}=require('../out/adb');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aFvQAAAAASUVORK5CYII=','base64');
test('deep links remain literal through both the host and Android shells',async()=>{
 const uri="myapp://screen?a=one&b=$(touch /tmp/nope)&q='value'".replace(/ /g,'%20');let args;
 const parts=deepLinkArgs(uri,'com.example.app');await shellLiteral({shell:async(_s,a)=>{args=a;return '';}},'phone',parts);
 assert.equal(args[args.indexOf("'-d'")+1],shellQuote(uri));assert.ok(args.every(a=>a.startsWith("'")));assert.throws(()=>deepLinkArgs('bad uri'),/valid/);assert.throws(()=>deepLinkArgs('app://ok','bad;pkg'),/valid/);
});
test('advanced ADB runner fixes the selected device and never expands local shell text',()=>{
 assert.deepEqual(splitArguments('shell echo "a b" \'$(bad)\''),['shell','echo','a b','$(bad)']);
 assert.deepEqual(deviceAdbArgs('phone','logcat -d -t 100'),['-s','phone','logcat','-d','-t','100']);
 for(const command of ['kill-server','start-server','-s another shell id','connect host:5555'])assert.throws(()=>deviceAdbArgs('phone',command),/device-scoped/);
 assert.throws(()=>splitArguments('shell "open'),/quote/);
 assert.deepEqual(new Adb(()=>'/path with spaces/adb').terminalOptions('a b'),{shellPath:'/path with spaces/adb',shellArgs:['-s','a b','shell']});
});
test('clipboard frame validation rejects text, oversized dimensions and malformed PNG headers',()=>{
 assert.equal(validatePng(png),png);assert.throws(()=>validatePng(Buffer.from('not png')),/valid PNG/);
 const altered=Buffer.from(png);altered.writeUInt32BE(20000,16);assert.throws(()=>validatePng(altered),/dimensions/);
});
test('ADB screenshot capture preserves binary bytes and reports non-PNG/error output',async()=>{
 function adb(bytes,code=0){return {stream:args=>{assert.deepEqual(args,['-s','phone','exec-out','screencap','-p']);const c=new EventEmitter();c.stdout=new PassThrough();c.stderr=new PassThrough();c.kill=()=>true;process.nextTick(()=>{c.stdout.end(bytes);if(code)c.stderr.end('device offline');c.emit('close',code);});return c;}};}
 assert.deepEqual(await captureScreenshot(adb(png),'phone'),png);await assert.rejects(captureScreenshot(adb(Buffer.from('denied')),'phone'),/valid PNG/);await assert.rejects(captureScreenshot(adb(png,1),'phone'),/offline/);
});
