import type * as VSCode from 'vscode';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { Adb, Device, escapeHtml as html } from './adb';
import { page } from './ui';
import { HelperClient, HelperStatus, HELPER_PACKAGE } from './helperClient';
import { downloadSession } from './recorder';
import { captureScreenshot, copyPngToClipboard, deepLinkArgs, deviceAdbArgs, shellLiteral, validatePng } from './deviceControl';
import { validPackage } from './apk';
import { launchApp } from './deviceActions';

export const devicePresets: Record<string,{label:string;args:string[]}> = {
  home:{label:'Home',args:['input','keyevent','KEYCODE_HOME']},back:{label:'Back',args:['input','keyevent','KEYCODE_BACK']},recents:{label:'Recents',args:['input','keyevent','KEYCODE_APP_SWITCH']},
  wake:{label:'Wake screen',args:['input','keyevent','KEYCODE_WAKEUP']},sleep:{label:'Sleep screen',args:['input','keyevent','KEYCODE_SLEEP']},volumeUp:{label:'Volume +',args:['input','keyevent','KEYCODE_VOLUME_UP']},volumeDown:{label:'Volume −',args:['input','keyevent','KEYCODE_VOLUME_DOWN']},
  settings:{label:'Settings',args:['am','start','-a','android.settings.SETTINGS']},wifi:{label:'Wi-Fi settings',args:['am','start','-a','android.settings.WIFI_SETTINGS']},bluetooth:{label:'Bluetooth settings',args:['am','start','-a','android.settings.BLUETOOTH_SETTINGS']},
  packages:{label:'Installed apps',args:['pm','list','packages','-3']},properties:{label:'Device properties',args:['getprop']},battery:{label:'Battery',args:['dumpsys','battery']},memory:{label:'Memory',args:['dumpsys','meminfo']},activities:{label:'Activities',args:['dumpsys','activity','activities']},display:{label:'Display',args:['wm','size']},
};
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
    constructor(readonly device:Device){
      this.root=join(context.globalStorageUri.fsPath,'device-captures',Buffer.from(device.serial).toString('hex'));
      this.panel=vscode.window.createWebviewPanel('mota.device',`${device.model} · Device controls`,vscode.ViewColumn.One,{enableScripts:true,retainContextWhenHidden:true,localResourceRoots:[vscode.Uri.file(this.root)]});
      this.panel.webview.html=this.html();
      this.panel.webview.onDidReceiveMessage(m=>{void this.action(m);});this.timer=setInterval(()=>{void this.pollCapture();},1000);
    }
    private async connect(){if(!this.client){const c=new HelperClient(adb,this.device.serial);try{const s=await c.connect();if(!s.ready)throw new Error('Enable MoTA Recorder accessibility on the device. Use Set up helper if needed.');if(this.closing)throw new Error('Device page closed.');this.client=c;}catch(e){await c.dispose();throw e;}}return this.client;}
    private state(){if(!this.closing)void this.panel.webview.postMessage({kind:'state',message:this.message,error:this.error,output:this.output,working:this.working,capture:this.capture,hasImage:!!this.lastImage,hasVideo:!!this.lastVideo});}
    private fail(operation:string,e:unknown){const text=e instanceof Error?e.message:String(e);this.message=text;this.error=`MoTA device control error\nDevice: ${this.device.model} (${this.device.serial})\nOperation: ${operation}\n${text}`;this.state();}
    private async action(m:any){
      if(!m||typeof m.action!=='string'||this.closing)return;
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
            if(!this.closing)await this.panel.webview.postMessage({kind:'screenshot',src:'data:image/png;base64,'+image.toString('base64')});this.message='Screenshot captured.';break;
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
          case 'preset':{const p=devicePresets[m.preset];if(!p)throw new Error('Unknown device action.');this.output=await shellLiteral(adb,this.device.serial,p.args);this.message=p.label+' completed.';break;}
          case 'deeplink':this.output=await shellLiteral(adb,this.device.serial,deepLinkArgs(String(m.uri||''),String(m.package||'')));if(/Error:|Exception|Permission Denial/i.test(this.output))throw new Error(this.output);this.message='Deep link sent to the device.';break;
          case 'app':{
            const pkg=String(m.package||'');if(!validPackage(pkg))throw new Error('Enter a valid app package ID.');
            if(m.operation==='launch'){this.output=await launchApp(adb,this.device.serial,pkg);this.message='App launched.';break;}
            if(!['force-stop','clear','uninstall'].includes(m.operation))throw new Error('Unknown app operation.');
            if(['clear','uninstall'].includes(m.operation)){const confirm=await vscode.window.showWarningMessage(`${m.operation==='clear'?'Delete all app data for':'Uninstall'} ${pkg} on ${this.device.model}?`,{modal:true},'Continue');if(confirm!=='Continue'||this.closing)break;}
            this.output=m.operation==='uninstall'?await adb.run(['-s',this.device.serial,'uninstall',pkg],120000):await shellLiteral(adb,this.device.serial,m.operation==='clear'?['pm','clear',pkg]:['am','force-stop',pkg]);this.message='App action completed.';break;
          }
          case 'tap':case 'swipe':{
            const values=(m.action==='tap'?[m.x,m.y]:[m.x,m.y,m.x2,m.y2]).map(Number);if(values.some(v=>!Number.isInteger(v)||v<0||v>20000))throw new Error('Enter valid screen coordinates.');
            const duration=Number(m.duration??300);if(!Number.isInteger(duration)||duration<1||duration>60000)throw new Error('Gesture duration must be 1–60000 ms.');
            this.output=await shellLiteral(adb,this.device.serial,['input',m.action,...values.map(String),...(m.action==='swipe'?[String(duration)]:[])]);this.message='Input sent.';break;
          }
          case 'text':if(typeof m.text!=='string'||m.text.length>4096)throw new Error('Text exceeds 4096 characters.');this.output=await shellLiteral(adb,this.device.serial,['input','text',m.text.replace(/ /g,'%s')]);this.message='Text sent. ADB text input supports a limited character set.';break;
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
        if(!this.closing)await this.panel.webview.postMessage({kind:'video',src:this.panel.webview.asWebviewUri(vscode.Uri.file(this.lastVideo)).toString()});this.message='Video ready. Play, pause, seek or copy the current frame.';
      }finally{this.capture='idle';this.sessionId='';}
    }
    private html(){
      const button=(action:string,label:string,extra='')=>`<button data-action="${action}" ${extra}>${label}</button>`;
      const preset=(id:string)=>button('preset',devicePresets[id].label,`data-preset="${id}" data-busy`);
      return page(`<style>.tabs{display:flex;gap:6px;border-bottom:1px solid var(--vscode-panel-border);padding-bottom:12px;margin-bottom:20px;flex-wrap:wrap}.tabs button[aria-selected=true]{outline:2px solid var(--vscode-focusBorder)}.control-panel[hidden]{display:none}.capture-grid{display:grid;grid-template-columns:minmax(240px,1fr) minmax(300px,1.3fr);gap:16px}.preview{display:flex;align-items:center;justify-content:center;min-height:230px;background:var(--vscode-editor-background);border-radius:8px}.preview img{max-height:540px;max-width:100%;padding:0;background:transparent}.preview video{max-width:100%;max-height:540px}.field{width:100%;margin:8px 0}textarea{font:inherit;min-height:110px;padding:12px;width:100%;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-panel-border)}.compact-input{width:100px}code{overflow-wrap:anywhere}@media(max-width:800px){.capture-grid{grid-template-columns:1fr}}</style>
      <header><div><small>DEVICE CONTROLS</small><h1>${html(this.device.model)}</h1><code>${html(this.device.serial)}</code></div><div class="actions">${button('screenshot','Capture screenshot','data-busy')}${button('setup','Set up helper')}${button('recordings','Input recordings')}</div></header>
      <p id="status" role="status">Ready.</p><section id="error-box" class="card" hidden><pre id="error" role="alert" tabindex="0" style="user-select:text"></pre>${button('copy-error','Copy error details')}</section>
      <nav class="tabs" role="tablist">${[['capture','Capture'],['apps','Apps & deep links'],['input','Input'],['diagnostics','Diagnostics'],['adb','ADB & files']].map(([id,label],i)=>`<button role="tab" data-tab="${id}" aria-selected="${i===0}">${label}</button>`).join('')}</nav>
      <section class="control-panel" data-panel="capture"><div class="capture-grid"><article class="card"><h2>Screenshot</h2><div class="actions">${button('screenshot','Capture now','data-busy')}${button('copy-image','Copy image','data-image disabled')}${button('save-image','Save PNG','data-image disabled')}</div><div class="preview"><p id="image-empty" class="muted">Capture the current device screen.</p><img id="image" alt="Current device screenshot" hidden></div></article>
      <article class="card"><h2>Screen recording</h2><div class="actions">${button('start-video','Record screen','id="start-video" data-busy')}${button('pause-video','Pause capture','id="pause-video" disabled')}${button('stop-video','Stop','id="stop-video" disabled')}${button('save-video','Save MP4','data-video disabled')}</div><p class="muted">Screen sharing requires the helper and approval on the device. Pause capture to omit a period from the saved video.</p><div class="preview"><p id="video-empty" class="muted">Your completed recording will appear here.</p><video id="video" controls preload="metadata" crossorigin="anonymous" hidden></video></div><label>Seek <input id="seek" type="range" min="0" max="0" step="0.01" value="0" disabled style="width:100%"></label><p id="time">0:00 / 0:00</p><div class="actions">${button('toggle-play','Play / pause','data-video disabled')}${button('copy-frame','Copy current frame','data-video disabled')}${button('save-frame','Save current frame','data-video disabled')}</div></article></div>${button('open-captures','Open captures folder')}</section>
      <section class="control-panel" data-panel="apps" hidden><article class="card"><h2>Apps</h2><label>Package ID<input class="field" id="package" placeholder="com.example.app"></label><div class="actions">${button('app','Launch','data-operation="launch" data-busy')}${button('app','Force stop','data-operation="force-stop" data-busy')}${button('app','Clear app data','data-operation="clear" data-busy')}${button('app','Uninstall','data-operation="uninstall" data-busy')}${button('install','Install APK')}${preset('packages')}</div></article><article class="card"><h2>Open deep link</h2><input id="uri" class="field" placeholder="myapp://screen?item=123" aria-label="Deep link URI"><p class="muted">Uses the optional package above to target an app.</p>${button('deeplink','Open on device','data-busy')}</article><article class="card"><h2>Device settings</h2><div class="actions">${['settings','wifi','bluetooth'].map(preset).join('')}${button('awake','Keep awake options')}${button('reboot','Reboot device','data-busy')}</div></article></section>
      <section class="control-panel" data-panel="input" hidden><article class="card"><h2>Navigation & keys</h2><div class="actions">${['home','back','recents','wake','sleep','volumeUp','volumeDown'].map(preset).join('')}</div></article><article class="card"><h2>Touch input</h2><label>X <input id="x" class="compact-input" type="number" min="0" value="100"> Y <input id="y" class="compact-input" type="number" min="0" value="100"></label><label>End X <input id="x2" class="compact-input" type="number" min="0" value="100"> End Y <input id="y2" class="compact-input" type="number" min="0" value="600"> Duration (ms) <input id="duration" class="compact-input" type="number" min="1" value="300"></label><div class="actions">${button('tap','Tap','data-busy')}${button('swipe','Swipe / hold','data-busy')}</div><label>Type into focused field<input id="text" class="field" placeholder="Text for adb input"></label>${button('text','Send text','data-busy')}<p class="muted">ADB typing has limited Unicode support. Use the helper Text control for Unicode input.</p></article></section>
      <section class="control-panel" data-panel="diagnostics" hidden><article class="card"><h2>Inspect this device</h2><div class="actions">${['properties','battery','memory','activities','display'].map(preset).join('')}${button('stats','Live device monitor')}${button('logs','Open logcat')}</div></article></section>
      <section class="control-panel" data-panel="adb" hidden><article class="card"><h2>Run a device command</h2><label>Mode <select id="mode"><option value="shell">Android shell</option><option value="adb">Device-scoped ADB arguments</option></select></label><textarea id="command" spellcheck="false" placeholder="dumpsys activity activities" aria-label="Device command"></textarea><p class="muted">Commands always target ${html(this.device.serial)}. Android shell mode runs shell syntax on the device. ADB mode accepts arguments such as <code>shell dumpsys battery</code> or <code>logcat -d -t 100</code>. Text output is bounded; use the interactive shell for long-running work.</p><div class="actions">${button('command','Run on this device','data-busy')}${button('terminal','Open interactive shell')}</div></article><article class="card"><h2>Files</h2><label>Absolute device path<input id="path" class="field" placeholder="/sdcard/Download/example.txt"></label><div class="actions">${button('push','Push file…','data-busy')}${button('pull','Pull file…','data-busy')}</div></article></section>
      <section class="card"><div class="row"><h2>Command output</h2>${button('copy-output','Copy output')}</div><pre id="output" tabindex="0" style="user-select:text">No command output yet.</pre></section>`,devicePageScript,this.panel.webview.cspSource);
    }
    async dispose(){if(this.closing)return;this.closing=true;clearInterval(this.timer);await this.operation;try{await this.stopCapture();}catch{/* Captures remain recoverable from the helper. */}await this.client?.dispose();}
  }
}
export const devicePageScript=String.raw`
const image=document.getElementById('image'),video=document.getElementById('video'),seek=document.getElementById('seek');
function report(error){document.getElementById('error-box').hidden=false;document.getElementById('error').textContent=String(error);api.postMessage({action:'client-error',message:String(error).slice(0,4000)});}
function pngBlob(data){const value=atob(data.slice(data.indexOf(',')+1)),bytes=new Uint8Array(value.length);for(let i=0;i<value.length;i++)bytes[i]=value.charCodeAt(i);return new Blob([bytes],{type:'image/png'});}
async function copyImage(data,fallback){try{if(!navigator.clipboard?.write||typeof ClipboardItem==='undefined')throw new Error('Native clipboard fallback');await navigator.clipboard.write([new ClipboardItem({'image/png':pngBlob(data)})]);api.postMessage({action:'copied'});}catch{api.postMessage(fallback);}}
function frame(){if(video.seeking)throw new Error('Wait for the seek to finish before copying the frame.');if(!video.videoWidth||video.readyState<2)throw new Error('Wait for a video frame to load, then pause or seek.');video.pause();const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;canvas.getContext('2d').drawImage(video,0,0);return canvas.toDataURL('image/png');}
document.addEventListener('click',e=>{const tab=e.target.closest('button[data-tab]');if(tab){document.querySelectorAll('[data-panel]').forEach(p=>p.hidden=p.dataset.panel!==tab.dataset.tab);document.querySelectorAll('[data-tab]').forEach(b=>b.setAttribute('aria-selected',String(b===tab)));return;}const b=e.target.closest('button[data-action]');if(!b||b.disabled)return;const action=b.dataset.action;
 if(action==='copy-image'){void copyImage(image.src,{action:'copy-image'});return;}
 if(action==='copy-frame'||action==='save-frame'){try{const png=frame();if(action==='copy-frame')void copyImage(png,{action,png});else api.postMessage({action,png});}catch(error){report(error);}return;}
 if(action==='toggle-play'){if(video.paused)video.play().catch(report);else video.pause();return;}
 const value=id=>document.getElementById(id).value;
 api.postMessage({action,preset:b.dataset.preset,operation:b.dataset.operation,package:value('package'),uri:value('uri'),x:value('x'),y:value('y'),x2:value('x2'),y2:value('y2'),duration:value('duration'),text:value('text'),command:value('command'),mode:value('mode'),path:value('path')});});
seek.addEventListener('input',()=>{video.currentTime=Number(seek.value);});
function clock(t){if(!Number.isFinite(t))return '0:00';return Math.floor(t/60)+':'+String(Math.floor(t%60)).padStart(2,'0');}
function updateTime(){const duration=Number.isFinite(video.duration)?video.duration:0;seek.max=String(duration);seek.value=String(video.currentTime||0);seek.disabled=!duration;document.getElementById('time').textContent=clock(video.currentTime)+' / '+clock(duration);}
video.addEventListener('loadedmetadata',updateTime);video.addEventListener('timeupdate',updateTime);video.addEventListener('error',()=>report('This video could not be decoded in the webview. Save the MP4 and open it in a video player.'));
window.addEventListener('message',e=>{const m=e.data;if(m.kind==='screenshot'){image.src=m.src;image.hidden=false;document.getElementById('image-empty').hidden=true;return;}if(m.kind==='video'){video.crossOrigin='anonymous';video.src=m.src;video.hidden=false;document.getElementById('video-empty').hidden=true;video.load();return;}if(m.kind!=='state')return;
 document.getElementById('status').textContent=m.message;document.getElementById('error-box').hidden=!m.error;document.getElementById('error').textContent=m.error;document.getElementById('output').textContent=m.output||'No command output yet.';
 document.querySelectorAll('[data-busy]').forEach(b=>b.disabled=m.working);document.querySelectorAll('[data-image]').forEach(b=>b.disabled=!m.hasImage);document.querySelectorAll('[data-video]').forEach(b=>b.disabled=!m.hasVideo);
 document.getElementById('start-video').disabled=m.working||m.capture!=='idle';document.getElementById('pause-video').disabled=m.working||!['recording','paused'].includes(m.capture);document.getElementById('pause-video').textContent=m.capture==='paused'?'Resume capture':'Pause capture';document.getElementById('stop-video').disabled=m.capture==='idle'||m.capture==='finalizing';});api.postMessage({action:'ready'});
`;
