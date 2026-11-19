import type * as VSCode from 'vscode';
import { promises as fs } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { Adb, Device, escapeHtml as html } from './adb';
import { HelperClient, HelperStatus, HELPER_PACKAGE, HELPER_VERSION } from './helperClient';
import { RecordingStore, Recording, RecordingMeta, RawRecording, atomicJson, readJson, validateSession, assertReplay, deviceIdentity, downloadSession, probeInput } from './recorder';
import { TouchDevice } from './inputEvents';
import { launchApp } from './deviceActions';
import { validPackage } from './apk';
import { page } from './ui';
import { installHelper } from './helperInput';

export function registerRecordings(vscode: typeof VSCode, context: VSCode.ExtensionContext, adb: Adb,
  choose: (item?: any) => Promise<Device[]>) {
  let window: RecordingWindow | undefined;
  const open = async (item?: any) => {
    if (window) { window.panel.reveal(); return window; }
    window = new RecordingWindow(item?.device?.state === 'device' ? item.device : undefined);
    window.panel.onDidDispose(() => { const old = window; window = undefined; void old?.dispose(); });
    await window.render(); return window;
  };
  context.subscriptions.push(
    vscode.commands.registerCommand('mota.recordings', async item => {await open(item);}),
    vscode.commands.registerCommand('mota.setupRecorder', async item => { const w = await open(item); await w.action('setup'); }),
    { dispose: () => { window?.panel.dispose(); } }
  );
  class RecordingWindow {
    readonly panel: VSCode.WebviewPanel;
    private store: RecordingStore;
    private target?: Device;
    private identity?: string;
    private client?: HelperClient;
    private status?: HelperStatus;
    private records: Recording[] = [];
    private selected?: Recording;
    private active?: { dir: string; meta: RecordingMeta; helperId: string; raw?: RawRecording };
    private videoPending = false;
    private disposed = false;
    private working = false;
    private workPromise: Promise<void> = Promise.resolve();
    private workFinished?: () => void;
    private lastError = '';
    private message = 'Select a device to set up the helper or start recording.';
    private polling = false;
    private monitor: ReturnType<typeof setInterval>;
    private finalizePromise?: Promise<void>;
    private replaying = false;
    private replayRun?: { dir: string; startedAt: string };
    constructor(target?: Device) {
      this.target = target;
      const configured = vscode.workspace.getConfiguration('mota').get<string>('recordingsDirectory', '');
      if(configured && !isAbsolute(configured))throw new Error('mota.recordingsDirectory must be an absolute path.');
      const root = configured || (vscode.workspace.workspaceFolders?.[0] ? join(vscode.workspace.workspaceFolders[0].uri.fsPath, '.mota', 'recordings') : join(context.globalStorageUri.fsPath, 'recordings'));
      this.store = new RecordingStore(root);
      this.panel = vscode.window.createWebviewPanel('mota.recordings', 'MoTA · Recordings', vscode.ViewColumn.One,
        { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.file(root)] });
      this.panel.webview.onDidReceiveMessage(async m => {
        if (typeof m?.action !== 'string') return;
        if (m.action === 'select' && Number.isInteger(m.index) && this.records[m.index]) { this.selected = this.records[m.index]; await this.render(); return; }
        await this.action(m.action);
      });
      this.monitor = setInterval(() => { void this.poll(); }, 1500);
    }
    private async device() {
      if (this.target) return this.target;
      const targets = await choose();
      if (!targets.length) throw new Error('Choose a ready device.');
      const d = targets.length === 1 ? targets[0] : (await vscode.window.showQuickPick(targets.map(device => ({ label: device.model, description: device.serial, device })), { title: 'Record/replay on one device' }))?.device;
      if (!d || this.disposed) throw new Error('Device selection cancelled.'); this.target = d; return d;
    }
    private async connect() {
      const d = await this.device();
      if (!this.client) {
        const c = new HelperClient(adb, d.serial);
        try { this.status = await c.connect(); this.identity = await deviceIdentity(adb, d.serial);if(this.disposed)throw new Error("Recordings page closed."); this.client = c; }
        catch (e) { await c.dispose(); throw e; }
      } else {this.status = await this.client.request('status');this.identity=await deviceIdentity(adb,d.serial);}
      if (!this.status?.ready) throw new Error('Enable MoTA Recorder in Android Accessibility settings, then refresh status.');
      return this.client;
    }
    async action(action: string) {
      // Stop remains available while Android is waiting for capture consent.
      if (action === 'stop' && this.videoPending) { this.videoPending = false; await this.client?.request('cancelVideo').catch(() => {}); this.message = 'Cancelled waiting for video consent. Dismiss any capture prompt on the device.'; await this.render(); return; }
      if (this.working || this.disposed) return;
      if(action!=='copy-error')this.lastError='';
      this.working = true;this.workPromise=new Promise(resolve=>{this.workFinished=resolve;});
      try {
        switch (action) {
          case 'copy-error': if(this.lastError){await vscode.env.clipboard.writeText(this.lastError);this.message='Error details copied to clipboard.';}break;
          case 'setup': {
            if (this.active || this.replaying) throw new Error('Stop the active session first.');
            const d = await this.device(); const apk = context.asAbsolutePath('resources/mota-recorder.apk');
            if (!(await fs.stat(apk)).isFile()) throw new Error('Bundled helper APK is missing. Reinstall the MoTA extension.');
            const sdk = Number(await adb.shell(d.serial, ['getprop', 'ro.build.version.sdk']));
            if (!Number.isInteger(sdk) || sdk < 29) throw new Error('The recorder helper requires Android 10 or newer.');
            const via = await installHelper(adb, d.serial, apk);
            await this.client?.dispose(); this.client = undefined;
            await adb.shell(d.serial, ['am', 'start', '-n', `${HELPER_PACKAGE}/.MainActivity`]);
            this.message = `Helper ${HELPER_VERSION} installed${via === 'device-owner' ? ' by the managed helper (adb install is blocked on this phone)' : ''}. On the device, enable its accessibility service if it is off. Use Refresh status when ready.`; break;
          }
          case 'device': {
            if (this.active || this.replaying) throw new Error('Stop the active session before switching devices.');
            await this.client?.dispose(); this.client = undefined; this.target = undefined; this.identity = undefined; this.status = undefined;
            await this.device(); this.message = 'Device selected. Set up the helper or refresh status.'; break;
          }
          case 'refresh': await this.connect(); this.message = this.status?.message || 'Helper connected.'; break;
          case 'start': await this.start(); break;
          case 'stop': if (this.active) await this.finish(); else if (this.replaying && this.client) {
            this.status = await this.client.request('cancel'); this.replaying = false; await this.saveReplay('cancelled'); this.message = 'Replay cancelled. An already dispatched gesture may finish.';
          } break;
          case 'import': await this.importZip(); break;
          case 'collect': await this.collect(); break;
          case 'replay': await this.replay(); break;
          case 'folder': await fs.mkdir(this.store.root, { recursive: true }); await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(this.selected?.dir || this.store.root)); break;
          case 'helper': { const d = await this.device(); await adb.shell(d.serial, ['am', 'start', '-n', `${HELPER_PACKAGE}/.MainActivity`]); break; }
          default: return;
        }
      } catch (e) { this.reportError(action,e); }
      finally { this.working = false;this.workFinished?.();this.workFinished=undefined; await this.render(); }
    }
    private async start() {
      if (this.active || this.replaying) throw new Error('Stop the active session first.');
      const client = await this.connect(); if (this.status?.recording || this.status?.playing || this.status?.busy || this.status?.videoActive) throw new Error('The helper is busy. Stop it on the device first.');
      const mode = await vscode.window.showQuickPick([{ label: 'ADB input recording', description: 'Normal direct interaction; requires readable multitouch events and natural orientation', value: 'adb' }, { label: 'Overlay recording', description: 'Fallback: each gesture reaches the app after finger-up', value: 'overlay' }], { title: 'Recording mode' });
      if (!mode || this.disposed) return;
      let touch: TouchDevice[] | undefined;
      if (mode.value === 'adb') {
        if (this.status!.rotation !== 0) throw new Error('ADB recording requires natural display orientation. Rotate the device or choose overlay mode.');
        const candidates = await probeInput(adb, this.target!.serial);
        if (!candidates.length) throw new Error('No readable multitouch device was found. Choose overlay recording instead.');
        touch = candidates;
      }
      const name = await vscode.window.showInputBox({ title: 'Recording name', value: 'Device flow' }); if (name === undefined || this.disposed) return;
      const pkg = await vscode.window.showInputBox({ title: 'Target app package (optional)', value: context.workspaceState.get('launchPackage', ''), placeHolder: 'com.example.app', validateInput: v => !v || validPackage(v) ? undefined : 'Enter a valid package ID' }); if (pkg === undefined || this.disposed) return;
      const video = await vscode.window.showQuickPick([{ label: 'Actions and screenshots', video: false }, { label: 'Actions, screenshots and screen video', description: 'Approve Android capture on the device; choose the entire screen', video: true }], { title: 'Capture options' }); if (!video || this.disposed) return;
      const staged = await this.store.create({ name: name.trim().slice(0, 200) || 'Device flow', device: this.target!.serial, identity: this.identity!, model: this.target!.model, mode: mode.value, targetPackage: pkg || undefined, complete: false });
      let started: HelperStatus | undefined;
      try {
        if(this.disposed)throw new Error("Recordings page closed.");
        if (pkg && !video.video) await launchApp(adb, this.target!.serial, pkg);
        if (video.video) {
          this.videoPending = true; this.message = 'Approve screen capture on the device. Choose the entire screen. Stop cancels waiting.'; await this.render();
          await adb.shell(this.target!.serial, ['am', 'start', '-n', `${HELPER_PACKAGE}/.MainActivity`, '--ez', 'mota.remoteVideo', 'true', '--es', 'mota.remoteMode', mode.value]);
          const deadline = Date.now() + 90000;
          while (this.videoPending && !this.disposed && Date.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, 750));
            const s = await client.request<HelperStatus>('status');
            if (this.videoPending && s.recording && s.videoActive && s.videoStatus === 'recording') { started = s; break; }
          }
          this.videoPending = false;
          if (!started) throw new Error('Video capture was not approved in time. Dismiss the prompt before starting another session.');
          if (pkg) await launchApp(adb, this.target!.serial, pkg);
        }
        if (mode.value === 'adb') {
          const raw = new RawRecording(adb, client, this.status!, touch!, staged.dir, staged.meta, () => { void this.progress(); });
          try{await raw.start(started);}catch(e){await raw.stop().catch(()=>{});throw e;}started = raw.display;
          this.active = { ...staged, helperId: started.session!, raw };
        } else {
          started ||= await client.request<HelperStatus>('start', { mode: 'overlay' });
          this.active = { ...staged, helperId: started.session! };
        }
        this.message = `Recording ${staged.meta.name} · ${mode.label}. Stop saves it to this computer.`;
      } catch (e) {
        if (started) await client.request('stop').catch(() => {});
        staged.meta.error = e instanceof Error ? e.message : String(e); await atomicJson(join(staged.dir, 'session.json'), staged.meta); throw e;
      }
    }
    private async finish() { return this.finalizePromise ||= this.finalize().finally(() => { this.finalizePromise = undefined; }); }
    private async finalize() {
      const active = this.active; if (!active || !this.client) return;
      try {
        if (active.raw) await active.raw.stop(); else await this.client.request('stop');
        const deadline = Date.now() + 20000;
        do { this.status = await this.client.request('status'); if (!this.status.busy && !this.status.videoActive) break; await new Promise(resolve => setTimeout(resolve, 300)); } while (Date.now() < deadline);
        if (this.status.busy || this.status.videoActive) throw new Error('Capture is still finalizing. Use Download device session when it finishes.');
        const rawData = active.raw ? validateSession(await readJson(join(active.dir, 'actions.json'))) : undefined;
        await downloadSession(this.client, active.helperId, active.dir);
        if (rawData) { const helper = await readJson(join(active.dir, 'actions.json')); await atomicJson(join(active.dir, 'actions.json'), { ...helper, ...rawData }); }
        const data = validateSession(await readJson(join(active.dir, 'actions.json')));
        active.meta.complete = !active.raw?.failure; active.meta.error = active.raw?.failure;
        await atomicJson(join(active.dir, 'session.json'), active.meta);
        this.selected = { dir: active.dir, meta: active.meta, data };
        if(active.meta.complete)this.message=`Saved ${data.actions.length} actions and available media.`;else this.reportError("record input",new Error(active.meta.error || "Incomplete recording"));
      } catch (e) {
        active.meta.complete = false; active.meta.error = e instanceof Error ? e.message : String(e); await atomicJson(join(active.dir, 'session.json'), active.meta); throw e;
      } finally { this.active = undefined; }
    }
    private async importZip() {
      if (this.active || this.replaying) throw new Error('Stop the active session first.');
      await this.connect();
      const files = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { 'Recording ZIP': ['zip'] }, title: 'Import a helper session; bind it to the selected device' }); if (!files?.[0]) return;
      const answer = await vscode.window.showWarningMessage('Bind this imported helper recording to the selected device? Only import sessions recorded on that device.', { modal: true }, 'Bind and import'); if (answer !== 'Bind and import') return;
      this.selected = await this.store.importZip(files[0].fsPath, { name: files[0].path.split('/').pop() || 'Imported session', device: this.target!.serial, identity: this.identity!, model: this.target!.model, mode: 'import', complete: false });
      this.message = `Imported ${this.selected.data.actions.length} actions.`;
    }
    private async collect() {
      if (this.active || this.replaying) throw new Error('Stop the active session first.');
      const c = await this.connect();
      const result = await c.request<{ sessions: { id: string; count: number; finished: boolean }[] }>('sessions');
      const chosen = await vscode.window.showQuickPick(result.sessions.filter(s => s.finished).map(s => ({ label: s.id, description: `${s.count} helper actions`, id: s.id })), { title: 'Download a completed session from this device' }); if (!chosen) return;
      const staged = await this.store.create({ name: chosen.label, device: this.target!.serial, identity: this.identity!, model: this.target!.model, mode: 'helper', complete: false });
      await downloadSession(c, chosen.id, staged.dir); const data = validateSession(await readJson(join(staged.dir, 'actions.json')));
      staged.meta.complete = true; await atomicJson(join(staged.dir, 'session.json'), staged.meta); this.selected = { ...staged, data }; this.message = 'Device session downloaded.';
    }
    private async replay() {
      if (!this.selected || this.active || this.replaying) throw new Error('Select a saved session and stop any active operation.');
      const c = await this.connect(); assertReplay(this.selected, this.target!, this.identity!, this.status!);
      const choice = await vscode.window.showWarningMessage(`Replay “${this.selected.meta.name}” on ${this.target!.model}? Prepare the original starting screen and app state. Recorded actions may submit forms or change data.`, { modal: true }, 'Replay'); if (choice !== 'Replay' || this.disposed) return;
      if (this.selected.meta.targetPackage) await launchApp(adb, this.target!.serial, this.selected.meta.targetPackage);
      this.status = await c.request('replay', { session: this.selected.data }); this.replaying = true;
      this.replayRun = { dir: this.selected.dir, startedAt: new Date().toISOString() }; this.message = 'Replay starts in three seconds. Stop cancels queued actions.';
    }
    private async saveReplay(outcome: string) {
      if (!this.replayRun) return;
      await atomicJson(join(this.replayRun.dir, 'replay-results.json'), { startedAt: this.replayRun.startedAt, endedAt: new Date().toISOString(), outcome, completedActions: this.status?.replayIndex, totalActions: this.status?.replayTotal, message: this.status?.message }); this.replayRun = undefined;
    }
    private reportError(operation:string,error:unknown){
      const message=error instanceof Error?error.message:String(error);
      this.message=message;
      this.lastError=[`MoTA recording error`, `Operation: ${operation}`, `Device: ${this.target?.model || 'not selected'} (${this.target?.serial || 'none'})`,
        `Helper: ${this.status?.version || 'not connected'}`, `State: recording=${!!this.status?.recording}, replaying=${!!this.status?.playing}, busy=${!!this.status?.busy}`,
        `Input device: ${this.active?.raw?.inputDevice?.name || 'not detected'}`, this.active?.raw ? `Input stream: ${this.active.raw.inputDiagnostics}` : '', `Message: ${message}`,error instanceof Error?error.stack || '':''].filter(Boolean).join('\n');
    }
    private async progress() {
      if (!this.disposed) await this.panel.webview.postMessage({ status: this.active?.raw ? `${this.message} ${this.active.raw.inputDevice ? "Touchscreen: " + this.active.raw.inputDevice.name : "Waiting for the first touch to detect the active touchscreen."}` : this.message, actions: this.active?.raw?.count ?? this.status?.actions ?? 0, replayIndex: this.status?.replayIndex, replayTotal: this.status?.replayTotal });
    }
    private async poll() {
      if (this.disposed || this.working || this.polling || !this.client) return; this.polling = true;
      try {
        this.status = await this.client.request('status');
        const raw=this.active?.raw;
        if(raw && (raw.display.width!==this.status.width || raw.display.height!==this.status.height || raw.display.rotation!==this.status.rotation))await raw.abort('Display changed during input recording.');
        if (this.active?.raw?.failure) { this.message = this.active.raw.failure; await this.finish(); await this.render(); }
        else if (this.active && !this.status.recording) { await this.finish(); await this.render(); }
        if (this.replaying && !this.status.playing) {
          this.replaying = false; this.message = this.status.message || 'Replay stopped.';
          await this.saveReplay(this.status.message === 'Replay complete' ? 'completed' : 'failed'); await this.render();
        }
        await this.progress();
      } catch (e) {
        this.reportError('monitor recording',e);
        if (this.active) { await this.active.raw?.stop().catch(() => {}); this.active.meta.complete = false; this.active.meta.error = this.message; await atomicJson(join(this.active.dir, 'session.json'), this.active.meta).catch(() => {}); this.active = undefined; }
        if (this.replaying) { await this.saveReplay('disconnected').catch(() => {}); this.replaying = false; }
        await this.client?.dispose(); this.client = undefined; await this.render();
      } finally { this.polling = false; }
    }
    async render() {
      if (this.disposed) return;
      this.records = await this.store.list(); if (this.selected) this.selected = this.records.find(r => r.meta.id === this.selected!.meta.id) || this.selected;
      const selected = this.selected;
      const thumbnails = new Map((selected?.data.screenshots || []).map(s=>[s.actionIndex,s]));
      const rows = selected?.data.actions.map((a, i) => {
        const shot = thumbnails.get(i);
        const src = shot ? this.panel.webview.asWebviewUri(vscode.Uri.file(join(selected.dir, shot.file))).toString() : '';
        const detail = a.type === 'gesture' ? `${a.strokes.length} finger path(s)` : a.type === 'global' ? ({ 1: 'Back', 2: 'Home', 3: 'Recents' }[a.action] || 'Navigation') : a.type === 'text' ? `${a.text.length} characters` : 'Volume key';
        return `<tr><td>${i + 1}</td><td>${(a.atMs / 1000).toFixed(2)}s</td><td>${html(a.type)} · ${html(detail)}</td><td>${src ? `<img alt="Screenshot after action ${i + 1}" src="${html(src)}" loading="lazy" style="max-width:150px;padding:0">` : '—'}</td></tr>`;
      }).join('') || '';
      const hasVideo = selected && await fs.stat(join(selected.dir, 'screen.mp4')).then(() => true, () => false);
      const video = hasVideo ? `<video controls preload="metadata" style="max-width:100%;max-height:480px" src="${html(this.panel.webview.asWebviewUri(vscode.Uri.file(join(selected!.dir, 'screen.mp4'))).toString())}"></video>` : '';
      this.panel.webview.html = page(`<header><div><h1>Recordings</h1><p>${html(this.target ? `${this.target.model} · ${this.target.serial}` : 'No device selected')}</p></div><div class="actions"><button data-action="device">Choose device</button><button data-action="setup">Set up helper</button><button data-action="refresh">Refresh status</button></div></header>
        <section class="card"><p id="status" role="status">${html(this.message)}</p>${this.lastError ? `<pre id="error-details" role="alert" tabindex="0" style="user-select:text">${html(this.lastError)}</pre><button class="secondary" data-action="copy-error">Copy error details</button>` : ''}<p id="counts">${this.active?.raw?.count ?? this.status?.actions ?? 0} actions</p><div class="actions"><button data-action="start" ${this.active || this.replaying || this.videoPending ? 'disabled' : ''}>Start recording</button><button data-action="stop" ${this.active || this.replaying || this.videoPending ? '' : 'disabled'}>Stop</button><button data-action="helper">Open helper on device</button></div></section>
        <div class="actions"><button data-action="import">Import ZIP</button><button data-action="collect">Download device session</button><button data-action="folder">Open recordings folder</button></div>
        <p class="muted">ADB mode records normal physical input where supported. Overlay mode delivers gestures after finger-up. Video requires device consent. Replay is limited to the bound device and recorded display configuration.</p>
        <section class="card"><h2>Saved sessions</h2>${this.records.map((r, i) => `<p><button data-action="select" data-index="${i}">${html(r.meta.name)}</button> · ${r.data.actions.length} actions · ${html(r.meta.model)} · ${r.meta.complete ? 'Saved' : 'Incomplete'} ${r.meta.error ? html(r.meta.error) : ''}</p>`).join('') || '<p>No saved sessions yet.</p>'}</section>
        ${selected ? `<section class="card"><h2>${html(selected.meta.name)}</h2><p>${selected.data.width} × ${selected.data.height} · rotation ${selected.data.rotation} · ${html(selected.meta.mode)}</p><button data-action="replay" ${selected.meta.complete && !this.active && !this.replaying ? '' : 'disabled'}>Replay on original device</button>${video}<table style="width:100%;text-align:left"><thead><tr><th>Action</th><th>Time</th><th>Input</th><th>Screenshot</th></tr></thead><tbody>${rows}</tbody></table></section>` : ''}`,
        `document.addEventListener('click',e=>{const b=e.target.closest('button[data-action]');if(b)api.postMessage({action:b.dataset.action,index:Number(b.dataset.index)});});window.addEventListener('message',e=>{const m=e.data;document.getElementById('status').textContent=m.status;document.getElementById('counts').textContent=m.replayTotal?'Replay '+m.replayIndex+' / '+m.replayTotal:m.actions+' actions';});`, this.panel.webview.cspSource);
    }
    async dispose() {
      if (this.disposed) return; this.disposed = true; if(this.videoPending)await this.client?.request('cancelVideo').catch(() => {});this.videoPending = false; clearInterval(this.monitor);
      await this.workPromise;
      try { if (this.active) await this.finish(); if (this.replaying) { await this.client?.request('cancel'); await this.saveReplay('cancelled'); } }
      catch { /* Local incomplete metadata remains recoverable. */ }
      await this.client?.dispose();
    }
  }
}
