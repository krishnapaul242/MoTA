import { execFile, spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { Adb } from './adb';
/** adb shell concatenates arguments: quote opaque values for the Android shell too. */
export function shellQuote(value: string) { return "'" + value.replace(/'/g, "'\\''") + "'"; }
export function shellLiteral(adb: Adb, serial: string, args: string[]) { return adb.shell(serial, args.map(shellQuote)); }
export function deepLinkArgs(uri: string, pkg = '') {
  if (!/^[a-zA-Z][a-zA-Z\d+.-]*:\S+$/.test(uri) || uri.length > 8192 || /[\x00-\x1f]/.test(uri)) throw new Error('Enter a valid deep link URI.');
  if (pkg && !/^[A-Za-z]\w*(?:\.[A-Za-z]\w*)+$/.test(pkg)) throw new Error('Enter a valid optional app package.');
  return ['am','start','-W','-a','android.intent.action.VIEW','-d',uri,...(pkg?['-p',pkg]:[])];
}
export function splitArguments(text: string): string[] {
  if (text.length > 16384 || /[\x00\r\n]/.test(text)) throw new Error('Enter a single command line under 16 KB.');
  const args: string[] = []; let quote='', escaped=false, token='', started=false;
  for(const ch of text){
    if(escaped){token+=ch;escaped=false;started=true;continue;}
    if(ch==='\\'&&quote!=="'"){escaped=true;started=true;continue;}
    if(quote){if(ch===quote)quote='';else token+=ch;continue;}
    if(ch==='"'||ch==="'"){quote=ch;started=true;continue;}
    if(/\s/.test(ch)){if(started){args.push(token);token='';started=false;}}else{token+=ch;started=true;}
  }
  if(escaped||quote)throw new Error('Close the quote or escape in the command.');if(started)args.push(token);return args;
}
export function deviceAdbArgs(serial: string, command: string) {
  const args=splitArguments(command);
  const allowed=['shell','exec-out','install','install-multiple','uninstall','push','pull','forward','reverse','get-state','get-serialno','get-devpath','jdwp','reboot','wait-for-device','bugreport','logcat','root','unroot','remount','disable-verity','enable-verity','tcpip','usb','reconnect'];
  if(!args.length||!allowed.includes(args[0]))throw new Error('Enter a device-scoped ADB command, such as shell dumpsys activity. Server-wide commands and target flags are not accepted.');
  // Prevent transport selection in the global argument position. The selected serial is fixed.
  return ['-s',serial,...args];
}
export function validatePng(bytes: Buffer) {
  if(bytes.length<33||bytes.length>32*1024*1024||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.toString('ascii',12,16)!=='IHDR')throw new Error('Capture did not return a valid PNG image. Protected screens may block capture.');
  const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
  if(!width||!height||width>16000||height>16000||width*height>64000000)throw new Error('Image dimensions exceed the copy limit.');return bytes;
}
export async function captureScreenshot(adb: Adb,serial:string){
  const child=adb.stream(['-s',serial,'exec-out','screencap','-p']);
  return new Promise<Buffer>((resolve,reject)=>{
    const chunks:Buffer[]=[];let size=0,stderr='',done=false;
    const finish=(error?:Error,data?:Buffer)=>{if(done)return;done=true;clearTimeout(timer);if(error){child.kill();reject(error);}else resolve(data!);};
    const timer=setTimeout(()=>finish(new Error('Screenshot timed out. Check the device connection.')),20000);
    child.stdout?.on('data',(b:Buffer)=>{size+=b.length;if(size>32*1024*1024)finish(new Error('Screenshot exceeds 32 MB.'));else chunks.push(b);});
    child.stderr?.on('data',b=>{stderr=(stderr+b.toString()).slice(-4096);});child.on('error',finish);
    child.on('close',code=>{if(code){finish(new Error(stderr||'Screenshot capture failed.'));return;}try{finish(undefined,validatePng(Buffer.concat(chunks)));}catch(e){finish(e as Error);}});
  });
}
function run(executable:string,args:string[],env?:NodeJS.ProcessEnv){return new Promise<void>((resolve,reject)=>execFile(executable,args,{env,timeout:10000,windowsHide:true},e=>e?reject(e):resolve()));}
/** Native fallback for webviews whose image Clipboard API is unavailable. */
export async function copyPngToClipboard(path:string,platform:NodeJS.Platform=process.platform){
  validatePng(await fs.readFile(path));
  if(platform==='darwin'){
    await run('osascript',['-e','set imageFile to POSIX file (system attribute "MOTA_IMAGE_PATH")','-e','set the clipboard to (read imageFile as «class PNGf»)'],{...process.env,MOTA_IMAGE_PATH:path});return;
  }
  if(platform==='win32'){
    await run('powershell.exe',['-NoProfile','-NonInteractive','-STA','-Command','Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $image=[System.Drawing.Image]::FromFile($env:MOTA_IMAGE_PATH); try { [System.Windows.Forms.Clipboard]::SetImage($image) } finally { $image.Dispose() }'],{...process.env,MOTA_IMAGE_PATH:path});return;
  }
  const data=await fs.readFile(path);
  try{await new Promise<void>((resolve,reject)=>{const p=spawn('wl-copy',['--type','image/png'],{stdio:['pipe','ignore','pipe']});p.on('error',reject);p.on('close',c=>c===0?resolve():reject(new Error('wl-copy failed')));p.stdin.on('error',reject);p.stdin.end(data);});}
  catch{try{await run('xclip',['-selection','clipboard','-t','image/png','-i',path]);}catch{throw new Error('Image clipboard access needs wl-copy (Wayland) or xclip (X11), or image clipboard support in the webview.');}}
}
