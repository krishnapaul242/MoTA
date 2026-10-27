const {test}=require('node:test');
const assert=require('node:assert/strict');
const {launchApp,setStayAwake,setScreenTimeout}=require('../out/deviceActions');
test('launch resolves launcher activity and targets the chosen device and Android user',async()=>{
 const calls=[];
 const adb={shell:async(serial,args)=>{calls.push([serial,args]);return args.includes('resolve-activity')?'priority=0\ncom.example.app/.MainActivity':'Status: ok\nActivity: com.example.app/.MainActivity';}};
 assert.match(await launchApp(adb,'phone','com.example.app','10'),/launched/);
 assert.equal(calls.length,2);assert.equal(calls[1][0],'phone');
 assert.ok(calls[0][1].includes('android.intent.category.LAUNCHER'));
 assert.deepEqual(calls[1][1],['am','start','-W','--user','10','-a','android.intent.action.MAIN','-c','android.intent.category.LAUNCHER','-n','com.example.app/.MainActivity']);
});
test('invalid IDs and missing or mismatched activities never start another app',async()=>{
 for(const output of ['No activity found','com.other.app/.MainActivity','com.example.app/.Main;rm']){
 const calls=[];const adb={shell:async(_serial,args)=>{calls.push(args);return output;}};
 await assert.rejects(launchApp(adb,'phone','com.example.app'),/no launcher activity/);
 assert.equal(calls.length,1);
 }
 await assert.rejects(launchApp({},'phone','--bad'),/valid app package/);
});
test('Android launch errors with a zero command exit are still failures',async()=>{
 const adb={shell:async(_s,args)=>args.includes('resolve-activity')?'com.example.app/.Main':'Error: Activity class does not exist'};
 await assert.rejects(launchApp(adb,'phone','com.example.app'),/does not exist/);
});
test('keep awake and timeout changes verify Android applied requested values',async()=>{
 const calls=[];let power='0',timeout='30000';
 const adb={shell:async(serial,args)=>{calls.push([serial,args]);const key=args[3];if(args[1]==='put'){if(key==='stay_on_while_plugged_in')power=args[4];else timeout=args[4];return '';}return key==='stay_on_while_plugged_in'?power:timeout;}};
 await setStayAwake(adb,'phone',7);await setStayAwake(adb,'phone',2);
 await setScreenTimeout(adb,'phone',3600000);await setScreenTimeout(adb,'phone',30000);
 assert.equal(power,'2');assert.equal(timeout,'30000');assert.ok(calls.every(c=>c[0]==='phone'));
 await assert.rejects(setStayAwake(adb,'phone',99),/Invalid/);
 await assert.rejects(setScreenTimeout(adb,'phone',-1),/Invalid/);
});
test('restricted device settings report failure',async()=>{
 await assert.rejects(setStayAwake({shell:async()=> 'SecurityException: Permission denied'},'p',7),/SecurityException/);
 await assert.rejects(setScreenTimeout({shell:async()=> '0'},'p',3600000),/did not apply/);
});

test('nested activity names remain literal on the Android shell',async()=>{
 let start;
 const adb={shell:async(_s,args)=>{if(args.includes('resolve-activity'))return 'com.example.app/.Outer$Activity';start=args;return 'Status: ok';}};
 await launchApp(adb,'phone','com.example.app');assert.equal(start.at(-1),"'com.example.app/.Outer$Activity'");
});
