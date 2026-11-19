import type * as VSCode from 'vscode';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { Adb, Device } from './adb';
import { ChildProcess } from 'node:child_process';
import { controlsHtml } from './webview/controlsView';
import { aiHost, AiLink, aiPoster, isAiMessage } from './webview/aiLink';
import { ScreenMirror, streamSize } from './h264';
import { connectionKind, FARM_INFO_SCRIPT, gestureArgs, parseFarmInfo, FarmInfo } from './deviceFarm';
import { HelperClient, HelperStatus, HELPER_PACKAGE } from './helperClient';
import { downloadSession } from './recorder';
import { captureScreenshot, copyPngToClipboard, deepLinkArgs, deviceAdbArgs, shellLiteral, validatePng } from './deviceControl';
import { validPackage } from './apk';
import { launchApp } from './deviceActions';
import { gestureParams, InputRouter } from './helperInput';

export const devicePresets: Record<string,{label:string;args:string[]}> = {
  home:{label:'Home',args:['input','keyevent','KEYCODE_HOME']},back:{label:'Back',args:['input','keyevent','KEYCODE_BACK']},recents:{label:'Recents',args:['input','keyevent','KEYCODE_APP_SWITCH']},
  wake:{label:'Wake screen',args:['input','keyevent','KEYCODE_WAKEUP']},sleep:{label:'Sleep screen',args:['input','keyevent','KEYCODE_SLEEP']},volumeUp:{label:'Volume +',args:['input','keyevent','KEYCODE_VOLUME_UP']},volumeDown:{label:'Volume −',args:['input','keyevent','KEYCODE_VOLUME_DOWN']},
  settings:{label:'Settings',args:['am','start','-a','android.settings.SETTINGS']},wifi:{label:'Wi-Fi settings',args:['am','start','-a','android.settings.WIFI_SETTINGS']},bluetooth:{label:'Bluetooth settings',args:['am','start','-a','android.settings.BLUETOOTH_SETTINGS']},
  packages:{label:'Installed apps',args:['pm','list','packages','-3']},properties:{label:'Device properties',args:['getprop']},battery:{label:'Battery',args:['dumpsys','battery']},memory:{label:'Memory',args:['dumpsys','meminfo']},activities:{label:'Activities',args:['dumpsys','activity','activities']},display:{label:'Display',args:['wm','size']},
};
const INPUT_KEYS=['home','back','recents','wake','sleep','volumeUp','volumeDown'];
export function registerDevicePage(vscode:typeof VSCode,context:VSCode.ExtensionContext,adb:Adb,choose:(item?:any)=>Promise<Device[]>){
  const windows=new Map<string,ControlPage>();
  context.subscriptions.push(vscode.commands.registerCommand('mota.device',async(item?:any)=>{
    const targets=await choose(item);if(!targets.length)return;
    const target=targets.length===1?targets[0]:(await vscode.window.showQuickPick(targets.map(device=>({label:device.model,description:device.serial,device})),{title:'Open controls for one device'}))?.device;
    if(!target)return;const existing=windows.get(target.serial);if(existing){existing.panel.reveal();return;}
    const window=new ControlPage(target);windows.set(target.serial,window);window.panel.onDidDispose(()=>{windows.delete(target.serial);void window.dispose();});
  }),{dispose:()=>{for(const w of windows.values())w.panel.dispose();}});
  class ControlPage {
    readonly panel:VSCode.WebviewPanel;
    readonly root:string;
    private lastImage?:string;
    private lastVideo?:string;
    private client?:HelperClient;
    private capture:'idle'|'awaiting'|'recording'|'paused'|'finalizing'='idle';
    private owner='';private sessionId='';private deadline=0;
    private working=false;private closing=false;private polling=false;
    private operation:Promise<void>=Promise.resolve();private operationDone?:()=>void;
    private message='Ready. Capture a screenshot or choose a device action.';private error='';private output='';
    private timer:ReturnType<typeof setInterval>;
    private input=new InputRouter(adb);
    private ai:AiLink;
    private liveOn=false;private mirror?:ScreenMirror;private shotBusy=false;private lastShot=0;private liveTimer?:ReturnType<typeof setInterval>;
    private info?:FarmInfo;private logs?:ChildProcess;private logLines:string[]=[];private logFlush?:ReturnType<typeof setTimeout>;
    constructor(readonly device:Device){
      this.root=join(context.globalStorageUri.fsPath,'device-captures',Buffer.from(device.serial).toString('hex'));
      this.panel=vscode.window.createWebviewPanel('mota.device',`${device.model} · Device controls`,vscode.ViewColumn.One,{enableScripts:true,retainContextWhenHidden:true,localResourceRoots:[vscode.Uri.file(this.root),...(vscode.workspace?.workspaceFolders??[]).map(f=>f.uri)]});
      this.panel.webview.html=controlsHtml(device,this.panel.webview.cspSource);
      this.ai=aiHost(context,adb).connect(aiPoster(vscode,this.panel,()=>this.closing));
      this.panel.webview.onDidReceiveMessage(m=>{void this.action(m);});this.timer=setInterval(()=>{void this.pollCapture();},1000);
      this.liveTimer=setInterval(()=>{void this.liveTick();},700);
    }
    private async connect(){if(!this.client){const c=new HelperClient(adb,this.device.serial);try{const s=await c.connect();if(!s.ready)throw new Error('Enable MoTA Recorder accessibility on the device. Use Set up helper if needed.');if(this.closing)throw new Error('Device page closed.');this.client=c;}catch(e){await c.dispose();throw e;}}return this.client;}
    private state(){if(!this.closing)void this.panel.webview.postMessage({kind:'state',message:this.message,error:this.error,output:this.output,working:this.working,capture:this.capture,hasImage:!!this.lastImage,hasVideo:!!this.lastVideo});}
    private fail(operation:string,e:unknown){const text=e instanceof Error?e.message:String(e);this.message=text;this.error=`MoTA device control error\nDevice: ${this.device.model} (${this.device.serial})\nOperation: ${operation}\n${text}`;this.state();}
    private post(m:unknown){if(!this.closing)void this.panel.webview.postMessage(m);}
    private async action(m:any){
      if(this.closing)return;
      if(isAiMessage(m)){await this.ai.handle(m);return;}
      if(!m||typeof m.action!=='string')return;
      try{if(await this.quick(m))return;}catch(e){this.fail(m.action,e);return;}
      if(m.action==='ready'){this.state();return;}
      if(m.action==='client-error'){this.fail('media preview / clipboard',String(m.message||'Preview failed').slice(0,4000));return;}
      if(m.action==='copied'){this.message='Image copied to clipboard.';this.state();return;}
      if(m.action==='copy-error'){await vscode.env.clipboard.writeText(this.error);return;}
      if(m.action==='copy-output'){await vscode.env.clipboard.writeText(this.output);return;}
      if(m.action==='stop-video'&&this.capture==='awaiting'){await this.stopCapture().catch(e=>this.fail('cancel screen capture',e));this.state();return;}
      if(this.working)return;this.working=true;this.operation=new Promise(r=>{this.operationDone=r;});this.error='';this.state();
      try{
        switch(m.action){
          case 'screenshot':{
            this.message='Capturing screenshot…';this.state();const image=await captureScreenshot(adb,this.device.serial);await fs.mkdir(this.root,{recursive:true,mode:0o700});
            this.lastImage=join(this.root,`screenshot-${randomUUID()}.png`);await fs.writeFile(this.lastImage,image,{mode:0o600});
            if(!this.closing)await this.panel.webview.postMessage({kind:'screenshot',src:'data:image/png;base64,'+image.toString('base64')});this.message='Screenshot captured.';void this.sendCaptures(this.lastImage.slice(this.root.length+1));break;
          }
          case 'copy-image':case 'copy-frame':case 'save-frame':{
            let path=this.lastImage;
            if(m.action!=='copy-image'){
              if(typeof m.png!=='string'||m.png.length>45*1024*1024||!/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(m.png))throw new Error('The video frame could not be read as PNG. Pause the video and try again.');
              const bytes=validatePng(Buffer.from(m.png.slice(m.png.indexOf(',')+1),'base64'));await fs.mkdir(this.root,{recursive:true,mode:0o700});path=join(this.root,`frame-${randomUUID()}.png`);await fs.writeFile(path,bytes,{mode:0o600});
            }
            if(!path)throw new Error('Capture a screenshot first.');
            if(m.action==='save-frame'){await this.save(path,'png');break;}
            if(vscode.env.remoteName)throw new Error('Image clipboard access is unavailable on this remote host. Save the image and copy it locally.');
            await copyPngToClipboard(path);this.message='Image copied to clipboard.';break;
          }
          case 'save-image':if(!this.lastImage)throw new Error('Capture a screenshot first.');await this.save(this.lastImage,'png');break;
          case 'save-video':if(!this.lastVideo)throw new Error('Finish a recording first.');await this.save(this.lastVideo,'mp4');break;
          case 'open-captures':await fs.mkdir(this.root,{recursive:true});await vscode.commands.executeCommand('revealFileInOS',vscode.Uri.file(this.root));break;
          case 'start-video':await this.startCapture();break;
          case 'pause-video':{if(!['recording','paused'].includes(this.capture))throw new Error('Screen recording is not active.');const c=await this.connect();await c.request(this.capture==='paused'?'resumeVideo':'pauseVideo',{owner:this.owner});this.capture=this.capture==='paused'?'recording':'paused';this.message=this.capture==='paused'?'Screen recording paused.':'Screen recording resumed.';break;}
          case 'stop-video':await this.stopCapture();break;
          case 'setup':await vscode.commands.executeCommand('mota.setupRecorder',{device:this.device});break;
          case 'recordings':await vscode.commands.executeCommand('mota.recordings',{device:this.device});break;
          case 'install':await vscode.commands.executeCommand('mota.install',{device:this.device});break;
          case 'stats':await vscode.commands.executeCommand('mota.stats',{device:this.device});break;
          case 'logs':await vscode.commands.executeCommand('mota.logcat',{device:this.device});break;
          case 'awake':await vscode.commands.executeCommand('mota.awake',{device:this.device});break;
          case 'preset':{const p=devicePresets[m.preset];if(!p)throw new Error('Unknown device action.');this.output=INPUT_KEYS.includes(m.preset)?await this.input.send(this.device.serial,p.args,{type:'key',key:m.preset}):await shellLiteral(adb,this.device.serial,p.args);this.message=p.label+' completed.';break;}
          case 'deeplink':this.output=await shellLiteral(adb,this.device.serial,deepLinkArgs(String(m.uri||''),String(m.package||'')));if(/Error:|Exception|Permission Denial/i.test(this.output))throw new Error(this.output);this.message='Deep link sent to the device.';break;
          case 'app':{
            const pkg=String(m.package||'');if(!validPackage(pkg))throw new Error('Enter a valid app package ID.');
            if(m.operation==='launch'){this.output=await launchApp(adb,this.device.serial,pkg);this.message='App launched.';break;}
            if(m.operation==='restart'){await shellLiteral(adb,this.device.serial,['am','force-stop',pkg]);this.output=await launchApp(adb,this.device.serial,pkg);this.message=pkg+' restarted.';break;}
            if(m.operation==='settings'){this.output=await shellLiteral(adb,this.device.serial,['am','start','-a','android.settings.APPLICATION_DETAILS_SETTINGS','-d','package:'+pkg]);this.message='Opened app info on the device.';break;}
            if(!['force-stop','clear','uninstall'].includes(m.operation))throw new Error('Unknown app operation.');
            if(['clear','uninstall'].includes(m.operation)){const confirm=await vscode.window.showWarningMessage(`${m.operation==='clear'?'Delete all app data for':'Uninstall'} ${pkg} on ${this.device.model}?`,{modal:true},'Continue');if(confirm!=='Continue'||this.closing)break;}
            this.output=m.operation==='uninstall'?await adb.run(['-s',this.device.serial,'uninstall',pkg],120000):await shellLiteral(adb,this.device.serial,m.operation==='clear'?['pm','clear',pkg]:['am','force-stop',pkg]);this.message={uninstall:pkg+' uninstalled.',clear:'App data cleared for '+pkg+'.','force-stop':pkg+' stopped.'}[m.operation as string]||'App action completed.';if(m.operation==='uninstall')void this.sendPackages();void this.sendAppInfo(pkg);break;
          }
          case 'tap':case 'swipe':{
            const values=(m.action==='tap'?[m.x,m.y]:[m.x,m.y,m.x2,m.y2]).map(Number);if(values.some(v=>!Number.isInteger(v)||v<0||v>20000))throw new Error('Enter valid screen coordinates.');
            const duration=Number(m.duration??300);if(!Number.isInteger(duration)||duration<1||duration>60000)throw new Error('Gesture duration must be 1–60000 ms.');
            const args=['input',m.action,...values.map(String),...(m.action==='swipe'?[String(duration)]:[])];this.output=await this.input.send(this.device.serial,args,gestureParams(args));this.message='Input sent.';break;
          }
          case 'text':if(typeof m.text!=='string'||m.text.length>4096)throw new Error('Text exceeds 4096 characters.');this.output=await this.input.send(this.device.serial,['input','text',m.text.replace(/ /g,'%s')],{type:'text',text:m.text});this.message=this.input.usesHelper(this.device.serial)?'Text sent through the helper.':'Text sent. ADB text input supports a limited character set.';break;
          case 'command':{
            if(typeof m.command!=='string'||!m.command.trim()||m.command.length>16384||m.command.includes('\0'))throw new Error('Enter a command under 16 KB.');
            this.message='Running on '+this.device.model+'…';this.state();
            this.output=m.mode==='shell'?await shellLiteral(adb,this.device.serial,['sh','-c',m.command]):await adb.run(deviceAdbArgs(this.device.serial,m.command),30000);this.message='Command completed.';break;
          }
          case 'terminal':{const options=adb.terminalOptions(this.device.serial);vscode.window.createTerminal({name:`MoTA · ${this.device.model}`, ...options}).show();this.message='Interactive device shell opened.';break;}
          case 'push':case 'pull':{
            if(typeof m.path!=='string'||!m.path.startsWith('/')||/[\x00\r\n]/.test(m.path)||m.path.length>4096)throw new Error('Enter an absolute path on the device.');
            if(m.action==='push'){const files=await vscode.window.showOpenDialog({canSelectMany:false,title:'Choose file to send to this device'});if(files?.[0])this.output=await adb.run(['-s',this.device.serial,'push',files[0].fsPath,m.path],180000);}
            else{const destination=await vscode.window.showSaveDialog({title:'Save file from device'});if(destination)this.output=await adb.run(['-s',this.device.serial,'pull',m.path,destination.fsPath],180000);}this.message='File transfer finished.';break;
          }
          case 'reboot':{const confirm=await vscode.window.showWarningMessage(`Reboot ${this.device.model}?`,{modal:true},'Reboot');if(confirm==='Reboot')this.output=await adb.run(['-s',this.device.serial,'reboot']);break;}
          default:return;
        }
      }catch(e){this.fail(m.action,e);}finally{this.working=false;this.operationDone?.();this.operationDone=undefined;this.state();}
    }
    /** Reads and live-screen actions: no busy lock, so input stays responsive during long operations. */
    private async quick(m:any):Promise<boolean>{
      const serial=this.device.serial;
      switch(m.action){
        case 'farm':await vscode.commands.executeCommand('mota.farm');return true;
        case 'live-start':this.liveOn=true;this.stopMirror();if(m.stream)this.startMirror();this.lastShot=0;return true;
        case 'video-error':this.mirror?.restart();return true;
        case 'video-unsupported':this.stopMirror();this.lastShot=0;return true;
        case 'gesture':{const args=gestureArgs(m);await this.input.send(serial,args,gestureParams(args));this.lastShot=0;return true;}
        case 'key':{if(!INPUT_KEYS.includes(m.key))throw new Error('Unknown key.');await this.input.send(serial,devicePresets[m.key].args,{type:'key',key:m.key});this.lastShot=0;return true;}
        case 'text':{if(typeof m.text!=='string'||!m.text||m.text.length>4096)throw new Error('Enter up to 4096 characters.');await this.input.send(serial,['input','text',m.text.replace(/ /g,'%s')],{type:'text',text:m.text});this.lastShot=0;return true;}
        case 'info':{this.info=parseFarmInfo(await adb.shell(serial,[FARM_INFO_SCRIPT]));this.post({kind:'info',info:this.info,connection:connectionKind(serial)});return true;}
        case 'packages':await this.sendPackages();return true;
        case 'app-info':if(validPackage(String(m.package||'')))await this.sendAppInfo(m.package);return true;
        case 'captures':await this.sendCaptures();return true;
        case 'select-capture':{const path=this.capturePath(m.name);if(!path)return true;if(path.endsWith('.mp4'))this.lastVideo=path;else this.lastImage=path;this.state();return true;}
        case 'diag':this.post({kind:'diag',diag:await this.diagnostics()});return true;
        case 'ls':{const path=String(m.path||'');if(!path.startsWith('/')||/[\x00\r\n]/.test(path)||path.length>4096)throw new Error('Enter an absolute folder path.');
          try{this.post({kind:'files',path,entries:parseLs(await shellLiteral(adb,serial,['ls','-la',path.replace(/\/?$/,'/')]))});}catch(e){this.post({kind:'files',path,entries:[],error:e instanceof Error?e.message:String(e)});}return true;}
        case 'logs-start':await this.startLogs(String(m.level||'I'),String(m.package||''));return true;
        case 'logs-stop':this.stopLogs();return true;
      }
      return false;
    }
    private startMirror(){
      const size=this.info?.width&&this.info.height?streamSize(this.info.width,this.info.height):undefined,serial=this.device.serial;
      const mirror=this.mirror=new ScreenMirror(adb,serial,size,connectionKind(serial)==='USB'?8_000_000:4_000_000,
        unit=>{if(this.mirror===mirror)this.post({kind:'video',serial,...unit});},
        ()=>{if(this.mirror===mirror)this.post({kind:'video-reset',serial});},
        text=>{if(this.mirror!==mirror)return;this.mirror=undefined;this.lastShot=0;this.post({kind:'video-failed',serial,text});});
      mirror.start();
    }
    private stopMirror(){this.mirror?.stop();this.mirror=undefined;}
    private async liveTick(){
      if(!this.liveOn||this.closing||this.mirror||this.shotBusy||this.panel.visible===false||Date.now()-this.lastShot<900)return;
      this.shotBusy=true;
      try{const png=await captureScreenshot(adb,this.device.serial);this.post({kind:'frame',serial:this.device.serial,src:'data:image/png;base64,'+png.toString('base64')});}
      catch(e){this.post({kind:'frame-error',serial:this.device.serial,text:e instanceof Error?e.message:String(e)});}
      finally{this.shotBusy=false;this.lastShot=Date.now();}
    }
    private async sendPackages(){
      try{const list=(await adb.shell(this.device.serial,['pm','list','packages','-3'])).split(/\r?\n/).map(l=>l.trim().replace(/^package:/,'')).filter(validPackage).sort();
        this.post({kind:'packages',list,last:context.workspaceState?.get?.('launchPackage','')});}
      catch(e){this.post({kind:'packages',list:[],error:`Couldn't list installed apps: ${e instanceof Error?e.message:String(e)}`});}
    }
    private async sendAppInfo(pkg:string){
      try{const [dump,pid]=await Promise.all([shellLiteral(adb,this.device.serial,['dumpsys','package',pkg]),shellLiteral(adb,this.device.serial,['pidof',pkg]).catch(()=>'')]);
        this.post({kind:'app-info',package:pkg,info:parsePackageDump(dump,pid)});}
      catch{this.post({kind:'app-info',package:pkg,info:null});}
    }
    private capturePath(name:unknown){
      if(typeof name!=='string'||!/^(?:[\w.-]+\.png|recording-[\w-]+\/screen\.mp4)$/.test(name))return undefined;return join(this.root,name);
    }
    private async sendCaptures(select?:string){
      const items:{name:string;kind:string;uri:string;time:number;size:number;label:string}[]=[];
      try{
        for(const entry of await fs.readdir(this.root,{withFileTypes:true})){
          const name=entry.isDirectory()?`${entry.name}/screen.mp4`:entry.name;
          if(!this.capturePath(name))continue;
          const stat=await fs.stat(join(this.root,name)).catch(()=>undefined);if(!stat)continue;
          items.push({name,kind:name.endsWith('.mp4')?'video':'image',uri:this.panel.webview.asWebviewUri(vscode.Uri.file(join(this.root,name))).toString(),time:stat.mtimeMs,size:stat.size,
            label:(name.endsWith('.mp4')?'Recording':name.startsWith('frame-')?'Video frame':'Screenshot')+' · '+new Date(stat.mtimeMs).toLocaleString()});
        }
      }catch{/* no captures yet */}
      items.sort((a,b)=>b.time-a.time);this.post({kind:'captures',items:items.slice(0,40),select});
    }
    private async diagnostics(){
      const serial=this.device.serial;
      const extra='echo @mem;head -3 /proc/meminfo;echo @df;df -h /data | tail -1;echo @build;getprop ro.build.display.id;echo @patch;getprop ro.build.version.security_patch;echo @abi;getprop ro.product.cpu.abi;echo @dens;wm density;echo @temp;dumpsys battery | grep -m1 temperature;true';
      const [base,more]=await Promise.all([adb.shell(serial,[FARM_INFO_SCRIPT]),adb.shell(serial,[extra])]);
      return {...summarizeDiagnostics(parseFarmInfo(base),more),model:this.device.model};
    }
    private async startLogs(level:string,pkg:string){
      this.stopLogs();
      if(!/^[VDIWEF]$/.test(level))throw new Error('Unknown log level.');
      const args=['-s',this.device.serial,'logcat','-v','time'];
      if(pkg){if(!validPackage(pkg))throw new Error('Choose a valid app.');const pid=(await shellLiteral(adb,this.device.serial,['pidof',pkg]).catch(()=>'')).trim().split(/\s+/)[0];
        if(!/^\d+$/.test(pid)){this.post({kind:'log-ended',text:`${pkg} isn't running. Launch it, then resume.`});return;}args.push('--pid',pid);}
      args.push('*:'+level);
      const child=this.logs=adb.stream(args);let partial='';
      const flush=()=>{this.logFlush=undefined;if(this.logLines.length){this.post({kind:'log',lines:this.logLines.splice(0)});}};
      child.stdout?.on('data',(b:Buffer)=>{const parts=(partial+b.toString()).split(/\r?\n/);partial=parts.pop()||'';for(const l of parts)if(l)this.logLines.push(l.slice(0,2000));if(this.logLines.length>500)this.logLines.splice(0,this.logLines.length-500);if(!this.logFlush)this.logFlush=setTimeout(flush,150);});
      child.on('close',()=>{if(this.logs!==child)return;this.logs=undefined;flush();this.post({kind:'log-ended',text:'Log stream ended. Resume to reconnect.'});});
      child.on('error',e=>{if(this.logs===child)this.post({kind:'log-ended',text:'Logcat failed: '+e.message});});
    }
    private stopLogs(){const c=this.logs;this.logs=undefined;c?.kill();if(this.logFlush){clearTimeout(this.logFlush);this.logFlush=undefined;}this.logLines=[];}
    private async save(source:string,type:'png'|'mp4'){
      const target=await vscode.window.showSaveDialog({title:type==='png'?'Save image':'Save recording',defaultUri:vscode.Uri.file(join(homedir(),'Downloads',`mota-${Date.now()}.${type}`)),filters:type==='png'?{'PNG image':['png']}:{'MP4 video':['mp4']}});
      if(target){if(target.fsPath!==source)await fs.copyFile(source,target.fsPath);this.message='Saved '+target.fsPath;}
    }
    private async startCapture(){
      if(this.capture!=='idle')throw new Error('Stop the current screen recording first.');
      const c=await this.connect(),status=await c.request<HelperStatus>('status');if(status.recording||status.playing||status.busy||status.videoActive)throw new Error('The helper is busy with another recording or replay.');
      if(this.closing)return;this.owner=randomUUID();this.capture='awaiting';this.deadline=Date.now()+90000;
      await adb.shell(this.device.serial,['am','start','-n',`${HELPER_PACKAGE}/.MainActivity`,'--ez','mota.remoteVideo','true','--es','mota.remoteMode','adb','--es','mota.remoteOwner',this.owner]);
      this.message='Approve screen capture on the device. Choose the entire screen.';
    }
    private async pollCapture(){
      if(this.closing||this.polling||this.working||this.capture==='idle'||this.capture==='finalizing'||!this.client)return;this.polling=true;
      try{
        const s=await this.client.request<HelperStatus>('status');
        if(this.capture==='awaiting'){
          if(s.captureOwner===this.owner&&s.session){this.sessionId=s.session;
            if(s.videoActive){this.capture=s.videoPaused?'paused':'recording';this.message='Recording the device screen.';}
            else if(s.videoStatus==='failed'){await this.stopCapture();throw new Error('Android could not start video capture. See the helper session notes.');}
          }
          if(this.capture==='awaiting'&&Date.now()>this.deadline){await this.stopCapture();throw new Error('Screen sharing was not approved in time.');}
        }else if(s.session!==this.sessionId||s.captureOwner!==this.owner){this.capture='idle';throw new Error('The helper recording was replaced by another session.');}
        else if(!s.videoActive){await this.stopCapture();}
        else this.capture=s.videoPaused?'paused':'recording';
        this.state();
      }catch(e){this.fail('screen recording',e);if(!['idle','finalizing'].includes(this.capture)){await this.client?.request('cancelVideo',{owner:this.owner}).catch(()=>{});this.capture='idle';}this.state();}
      finally{this.polling=false;}
    }
    private stopping?:Promise<void>;
    private stopCapture(){return this.stopping ||= this.finishCapture().finally(()=>{this.stopping=undefined;});}
    private async finishCapture(){
      if(!this.client||this.capture==='idle')return;
      if(this.capture==='awaiting'&&!this.sessionId){await this.client.request('cancelVideo',{owner:this.owner});this.capture='idle';this.message='Screen capture request cancelled.';return;}
      this.capture='finalizing';this.message='Finishing and downloading the video…';this.state();
      try{
        await this.client.request('stop',{owner:this.owner});let s:HelperStatus;const until=Date.now()+20000;
        do{s=await this.client.request('status');if(!s.videoActive&&!s.busy)break;await new Promise(r=>setTimeout(r,250));}while(Date.now()<until);
        if(s!.videoActive||s!.busy)throw new Error('Video is still finalizing. Download it from MoTA Recordings when it finishes.');
        if(s!.videoStatus!=='saved')throw new Error('No playable video was saved. The recording may have stopped too early or capture may be blocked.');
        const dir=join(this.root,`recording-${randomUUID()}`);await fs.mkdir(dir,{recursive:true,mode:0o700});await downloadSession(this.client,this.sessionId,dir);this.lastVideo=join(dir,'screen.mp4');
        if(!this.closing)await this.panel.webview.postMessage({kind:'video',src:this.panel.webview.asWebviewUri(vscode.Uri.file(this.lastVideo)).toString()});this.message='Video ready. Play, pause, seek or copy the current frame.';void this.sendCaptures(this.lastVideo.slice(this.root.length+1));
      }finally{this.capture='idle';this.sessionId='';}
    }
    async dispose(){if(this.closing)return;this.closing=true;clearInterval(this.timer);if(this.liveTimer)clearInterval(this.liveTimer);this.stopMirror();this.stopLogs();this.ai.dispose();await this.operation;try{await this.stopCapture();}catch{/* Captures remain recoverable from the helper. */}await this.client?.dispose();await this.input.dispose();}
  }
}
/** Parses `ls -la` output from toybox/busybox into folder entries (skips . and ..). */
export function parseLs(out:string){
  const entries:{name:string;dir:boolean;size:number;modified:string}[]=[];
  for(const line of out.split(/\r?\n/)){
    const m=line.match(/^([dlcbps-])[rwxsStT-]{9}\S*\s+\d+\s+\S+\s+\S+\s+(\d+)\s+(\d{4}-\d\d-\d\d \d\d:\d\d)\s+(.+)$/);if(!m)continue;
    const name=m[1]==='l'?m[4].split(' -> ')[0]:m[4];if(name==='.'||name==='..')continue;
    entries.push({name,dir:m[1]==='d'||m[1]==='l',size:+m[2],modified:m[3]});
  }
  return entries.sort((a,b)=>Number(b.dir)-Number(a.dir)||a.name.localeCompare(b.name));
}
/** Version, install dates and SDK levels from `dumpsys package <pkg>`; null when the app isn't installed. */
export function parsePackageDump(dump:string,pid=''){
  const get=(re:RegExp)=>dump.match(re)?.[1]?.trim();
  const versionName=get(/versionName=(\S+)/),versionCode=get(/versionCode=(\d+)/);
  if(!versionName&&!versionCode)return null;
  return {version:[versionName,versionCode&&`(${versionCode})`].filter(Boolean).join(' '),installed:get(/firstInstallTime=([^\r\n]+)/),updated:get(/lastUpdateTime=([^\r\n]+)/),
    targetSdk:get(/targetSdk=(\d+)/),minSdk:get(/minSdk=(\d+)/),debuggable:/pkgFlags=\[[^\]]*DEBUGGABLE/.test(dump),pid:pid.trim().split(/\s+/)[0]||''};
}
/** Health summary for the Diagnostics tab. `more` is the sectioned output of the extra diagnostics script. */
export function summarizeDiagnostics(info:FarmInfo,more:string){
  const sec:Record<string,string>={};let key='';
  for(const line of more.split(/\r?\n/)){const k=line.trim().match(/^@(\w+)$/);if(k){key=k[1];sec[key]='';}else if(key)sec[key]+=line+'\n';}
  const kb=(name:string)=>{const m=(sec.mem||'').match(new RegExp(name+':\\s*(\\d+)'));return m?+m[1]:undefined;};
  const total=kb('MemTotal'),avail=kb('MemAvailable');
  const df=(sec.df||'').trim().split(/\s+/);
  const temp=(sec.temp||'').match(/temperature:\s*(-?\d+)/);
  const dens=(sec.dens||'').match(/(?:Override|Physical) density:\s*(\d+)/g);
  return {battery:info.battery,charging:info.charging,temperature:temp?+temp[1]/10:undefined,
    memTotal:total?(total/1048576).toFixed(1):undefined,memUsed:total&&avail!==undefined?((total-avail)/1048576).toFixed(1):undefined,memPct:total&&avail!==undefined?Math.round((total-avail)/total*100):undefined,
    storageTotal:df.length>=4?df[1]:undefined,storageFree:df.length>=4?df[3]:undefined,width:info.width,height:info.height,
    density:dens?dens[dens.length-1].replace(/\D+/g,''):undefined,build:(sec.build||'').trim(),patch:(sec.patch||'').trim(),abi:(sec.abi||'').trim(),managed:info.managed};
}
