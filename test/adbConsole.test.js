const {test} = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {PassThrough} = require('node:stream');
const {parseAdbCommand,consoleInvocations,riskyAdbCommand,AdbConsole} = require('../out/adbConsole');
test('console command lines split like a shell and drop a leading adb', () => {
  assert.deepEqual(parseAdbCommand('adb shell getprop ro.product.model'),['shell','getprop','ro.product.model']);
  assert.deepEqual(parseAdbCommand(`shell 'echo $HOME; ls'  "a \\"b\\"" c\\ d ''`),['shell','echo $HOME; ls','a "b"','c d','']);
  assert.deepEqual(parseAdbCommand('   '),[]);
  assert.throws(() => parseAdbCommand('shell "oops'),/Unclosed/);
});
test('console targets each device with -s and refuses a typed device flag', () => {
  assert.deepEqual(consoleInvocations(['devices'],[]),[{args:['devices']}]);
  assert.deepEqual(consoleInvocations(['shell','id'],['a','b']),[{serial:'a',args:['-s','a','shell','id']},{serial:'b',args:['-s','b','shell','id']}]);
  assert.throws(() => consoleInvocations(['-s','x','shell'],['a']));
  assert.throws(() => consoleInvocations([],[]));
});
test('console asks before destructive commands', () => {
  for (const c of [['reboot'],['uninstall','x'],['shell','rm','-rf','/sdcard/x'],['shell','pm clear com.x'],['shell','ls; reboot'],['kill-server']]) assert.ok(riskyAdbCommand(c), c.join(' '));
  for (const c of [['devices'],['shell','getprop'],['shell','dumpsys','battery'],['logcat','-d'],['shell','echo','format']]) assert.ok(!riskyAdbCommand(c), c.join(' '));
});
test('console streams output per device and reports exit codes', async () => {
  const posts = [], calls = [];
  const adb = {stream(args){calls.push(args);const c=new EventEmitter();c.stdout=new PassThrough();c.stderr=new PassThrough();c.kill=()=>{};
    setImmediate(()=>{c.stdout.write('ok '+args[1]+'\n');c.stderr.write('warn\n');setTimeout(()=>c.emit('close',0),20);});return c;}};
  const con = new AdbConsole(adb, m => posts.push(m), async () => true, async () => {});
  const online = [{serial:'a',model:'A',state:'device'},{serial:'b',model:'B',state:'device'}];
  await con.message({action:'console-run',line:'shell id',target:'all'}, online);
  await new Promise(r => setTimeout(r, 150));
  assert.deepEqual(calls,[['-s','a','shell','id'],['-s','b','shell','id']]);
  assert.equal(posts.filter(p=>p.kind==='console-start').length,2);
  assert.ok(posts.some(p=>p.kind==='console-out'&&p.text==='ok a\n'&&!p.err));
  assert.ok(posts.some(p=>p.kind==='console-out'&&p.text==='warn\n'&&p.err));
  assert.equal(posts.filter(p=>p.kind==='console-exit'&&p.code===0).length,2);
  posts.length = 0;
  await con.message({action:'console-run',line:'shell id',target:'selected',serials:[]}, online);
  assert.equal(posts[0].kind,'console-error');
  con.dispose();
});
test('console skips a risky command the user declines', async () => {
  const posts = []; let streamed = false;
  const con = new AdbConsole({stream(){streamed=true;}}, m => posts.push(m), async () => false, async () => {});
  await con.message({action:'console-run',line:'reboot',target:'a'}, [{serial:'a',model:'A',state:'device'}]);
  assert.ok(!streamed); assert.equal(posts.length,0);
});
