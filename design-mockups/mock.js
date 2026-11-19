// Mockup helpers: inline icons (<svg data-i="name">), page navigation and a dark/light switch.
// The real extension would bundle the same icon set (or VS Code codicons).
const ICONS = {
  search: '<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14"/>',
  plus: '<path d="M8 3v10M3 8h10"/>',
  refresh: '<path d="M13 8a5 5 0 1 1-1.5-3.5M13 2.5v3h-3"/>',
  grid: '<rect x="2.5" y="2.5" width="4.5" height="4.5"/><rect x="9" y="2.5" width="4.5" height="4.5"/><rect x="2.5" y="9" width="4.5" height="4.5"/><rect x="9" y="9" width="4.5" height="4.5"/>',
  list: '<path d="M5 4h9M5 8h9M5 12h9M2 4h1M2 8h1M2 12h1"/>',
  usb: '<path d="M6 2v3M10 2v3M4.5 5h7v3a3.5 3.5 0 0 1-7 0zM8 11.5V14"/>',
  wifi: '<path d="M2 6.5a9 9 0 0 1 12 0M4 9a6 6 0 0 1 8 0M6 11.5a3 3 0 0 1 4 0"/>',
  wifiOff: '<path d="M2 6.5a9 9 0 0 1 12 0M4 9a6 6 0 0 1 8 0M6 11.5a3 3 0 0 1 4 0M2 2l12 12"/>',
  battery: '<rect x="1.5" y="5" width="11.5" height="6" rx="1"/><path d="M14.5 7v2"/>',
  bolt: '<path d="M9 1.5 4 9h4l-1 5.5L12 7H8z"/>',
  home: '<path d="M2.5 7.5 8 3l5.5 4.5M4 6.5V13h8V6.5"/>',
  back: '<path d="M10 3 5 8l5 5"/>',
  recents: '<rect x="3" y="3" width="10" height="10" rx="1.5"/>',
  power: '<path d="M8 2v6M4.6 4.2a5 5 0 1 0 6.8 0"/>',
  camera: '<rect x="2" y="4.5" width="12" height="8.5" rx="1.5"/><circle cx="8" cy="8.7" r="2.3"/><path d="M6 4.5 7 3h2l1 1.5"/>',
  record: '<circle cx="8" cy="8" r="5.5"/><circle cx="8" cy="8" r="2.3" fill="currentColor"/>',
  stop: '<rect x="4" y="4" width="8" height="8" rx="1" fill="currentColor"/>',
  more: '<circle cx="3.5" cy="8" r=".9" fill="currentColor"/><circle cx="8" cy="8" r=".9" fill="currentColor"/><circle cx="12.5" cy="8" r=".9" fill="currentColor"/>',
  close: '<path d="M4 4l8 8M12 4l-8 8"/>',
  warn: '<path d="M8 2 1.5 13.5h13z"/><path d="M8 6.5v3.2M8 11.6v.2"/>',
  error: '<circle cx="8" cy="8" r="6"/><path d="M8 4.8v3.6M8 10.9v.2"/>',
  check: '<path d="M3 8.5 6.5 12 13 4.5"/>',
  checkCircle: '<circle cx="8" cy="8" r="6"/><path d="M5.3 8.2 7.2 10l3.5-4"/>',
  volUp: '<path d="M2.5 6h2.5L8.5 3v10L5 10H2.5zM11 5.5a3.5 3.5 0 0 1 0 5M12.8 3.8a6 6 0 0 1 0 8.4"/>',
  volDown: '<path d="M2.5 6h2.5L8.5 3v10L5 10H2.5zM11 5.5a3.5 3.5 0 0 1 0 5"/>',
  rotate: '<path d="M3 8a5 5 0 0 1 9-3M12 2.5V5H9.5M13 8a5 5 0 0 1-9 3M4 13.5V11h2.5"/>',
  keyboard: '<rect x="1.5" y="4" width="13" height="8" rx="1.5"/><path d="M4 7h1M7 7h1M10 7h1M5 9.5h6"/>',
  popout: '<path d="M9 2.5h4.5V7M13.5 2.5 8 8M6.5 3.5h-4v10h10v-4"/>',
  package: '<path d="M8 1.8 13.5 4.8v6.4L8 14.2 2.5 11.2V4.8zM2.5 4.8 8 7.8l5.5-3M8 7.8v6.4"/>',
  terminal: '<rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><path d="M4.5 6l2 2-2 2M8.5 10.5h3"/>',
  play: '<path d="M5 3.5v9l7-4.5z"/>',
  pause: '<path d="M5.5 3.5v9M10.5 3.5v9"/>',
  download: '<path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10"/>',
  chevronDown: '<path d="M4 6l4 4 4-4"/>',
  chevronRight: '<path d="M6 4l4 4-4 4"/>',
  arrowLeft: '<path d="M13 8H3M7 4 3 8l4 4"/>',
  thermo: '<path d="M6.5 9.5V3a1.5 1.5 0 0 1 3 0v6.5a3 3 0 1 1-3 0z"/>',
  trash: '<path d="M3 4.5h10M6 4.5V3h4v1.5M4.5 4.5l.7 9h5.6l.7-9"/>',
  link: '<path d="M6.5 9.5l3-3M7 4.5l1-1a2.8 2.8 0 0 1 4 4l-1 1M9 11.5l-1 1a2.8 2.8 0 0 1-4-4l1-1"/>',
  folder: '<path d="M1.5 4.5V12a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1H8L6.5 3.5h-4a1 1 0 0 0-1 1z"/>',
  file: '<path d="M4 1.5h5.5L12.5 4.5V14.5h-8.5zM9.5 1.5v3h3"/>',
  activity: '<path d="M1.5 8.5h3l2-5 3 9 2-4h3"/>',
  logs: '<path d="M3 3.5h10M3 6.5h10M3 9.5h7M3 12.5h5"/>',
  apps: '<rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="9" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="2.5" y="9" width="4.5" height="4.5" rx="1"/><rect x="9" y="9" width="4.5" height="4.5" rx="1"/>',
  info: '<circle cx="8" cy="8" r="6"/><path d="M8 7.2v3.8M8 5v.2"/>',
  settings: '<circle cx="8" cy="8" r="2"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"/>',
  copy: '<rect x="5" y="5" width="8.5" height="8.5" rx="1"/><path d="M3 10.5V3a.5.5 0 0 1 .5-.5H11"/>',
  upload: '<path d="M8 10.5v-8M4.5 6 8 2.5 11.5 6M3 13.5h10"/>',
  sort: '<path d="M5 3v10M2.5 10.5 5 13l2.5-2.5M11 13V3M8.5 5.5 11 3l2.5 2.5"/>',
};
function drawIcons(root = document) {
  root.querySelectorAll('svg[data-i]').forEach(svg => {
    if (svg.dataset.drawn) return;
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('i');
    svg.innerHTML = ICONS[svg.dataset.i] || '';
    svg.dataset.drawn = '1';
  });
}
const PAGES = [['index.html', 'Overview'], ['farm.html', 'Device farm'], ['farm-live.html', 'Farm · live view'], ['controls.html', 'Device controls'], ['monitor.html', 'Device monitor'], ['install.html', 'Install APK'], ['tests-setup.html', 'Tests · setup'], ['tests-run.html', 'Tests · running'], ['tests-results.html', 'Tests · results']];
function mockNav() {
  const here = location.pathname.split('/').pop() || 'index.html';
  const nav = document.createElement('nav');
  nav.className = 'mock-nav';
  nav.setAttribute('aria-label', 'Mockup pages (not part of the design)');
  nav.innerHTML = PAGES.map(([href, label]) => `<a href="${href}"${href === here ? ' aria-current="page"' : ''}>${label}</a>`).join('') + '<button type="button" id="theme">Light theme</button>';
  document.body.prepend(nav);
  const apply = t => { document.documentElement.dataset.theme = t; nav.querySelector('#theme').textContent = t === 'dark' ? 'Light theme' : 'Dark theme'; try { localStorage.setItem('mota-mock-theme', t); } catch {} };
  let saved = 'dark'; try { saved = localStorage.getItem('mota-mock-theme') || 'dark'; } catch {}
  apply(saved);
  nav.querySelector('#theme').addEventListener('click', () => apply(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
}
document.addEventListener('DOMContentLoaded', () => { mockNav(); drawIcons(); });

// ---- Claude dock (shared by farm pages): <div class="ai-dock" data-scope="..." data-open></div>
Object.assign(ICONS, {
  sparkle: '<path d="M8 1.5c.4 3.3 1.9 4.9 5.5 5.5-3.6.6-5.1 2.2-5.5 5.5-.4-3.3-1.9-4.9-5.5-5.5 3.6-.6 5.1-2.2 5.5-5.5z"/><path d="M13 11.5c.15 1 .6 1.5 1.5 1.65-.9.15-1.35.6-1.5 1.6-.15-1-.6-1.45-1.5-1.6.9-.15 1.35-.65 1.5-1.65z"/>',
  send: '<path d="M8 13V3M3.5 7.5 8 3l4.5 4.5"/>',
  spinner: '<path d="M8 2a6 6 0 1 1-6 6"/>',
  history: '<path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9M2.5 2.5v2.5H5M8 5v3l2 1.5"/>',
  shield: '<path d="M8 1.8 13 3.6v4c0 3.2-2.2 5.6-5 6.6-2.8-1-5-3.4-5-6.6v-4z"/>',
  minimize: '<path d="M4 6l4 4 4-4"/>',
  newchat: '<path d="M8 3v10M3 8h10"/>',
  gauge: '<path d="M2.5 11a5.5 5.5 0 1 1 11 0"/><path d="M8 11l2.5-3"/>',
  flask: '<path d="M6 1.8h4M6.5 1.8v4L2.8 12.4a1.2 1.2 0 0 0 1 1.8h8.4a1.2 1.2 0 0 0 1-1.8L9.5 5.8v-4M4.6 9.5h6.8"/>',
  phone: '<rect x="4.5" y="1.5" width="7" height="13" rx="1.5"/><path d="M7 12.5h2"/>',
});
function claudeDock(el) {
  const scope = el.dataset.scope || 'All ready devices';
  el.setAttribute('aria-label', 'Claude assistant');
  el.innerHTML = `
  <div class="ai-panel" id="ai-panel">
    <div class="ai-head">
      <svg data-i="sparkle" style="color:var(--vscode-charts-blue)"></svg>
      <strong style="color:var(--mota-heading)" id="ai-title">Claude</strong>
      <span class="small muted" id="ai-sub">Cart crash check · 2 devices</span>
      <span class="spacer"></span>
      <span class="usage" title="Tokens used in this conversation, of its limit"><span class="meter"><span style="width:30%"></span></span>12K / 40K tokens</span>
      <button class="icon-btn" title="New conversation" aria-label="New conversation"><svg data-i="newchat"></svg></button>
      <button class="icon-btn" title="History" aria-label="Conversation history"><svg data-i="history"></svg></button>
      <button class="icon-btn" title="Permissions: what Claude may do without asking" aria-label="Permissions"><svg data-i="shield"></svg></button>
      <button class="icon-btn" title="Collapse" aria-label="Collapse panel" data-ai="collapse"><svg data-i="minimize"></svg></button>
    </div>
    <div class="ai-feed" id="ai-feed" role="log" aria-label="Conversation with Claude">
      <div class="msg-user">Install the latest debug build on the selected phones, open the cart, and tell me why it crashes on the Galaxy.</div>
      <div class="approval" style="border-color: var(--vscode-panel-border)" role="group" aria-label="Plan">
        <div class="row" style="gap:8px"><svg data-i="checkCircle" style="color:var(--vscode-testing-iconPassed)"></svg><strong style="color:var(--mota-heading)">Plan approved</strong><span class="small muted">10:42 · Pixel 8 Pro, Galaxy S23</span></div>
        <ol class="small" style="margin:0;padding-left:20px"><li>Install <code>app-debug.apk</code> (2.5.0)</li><li>Open <code>shop://cart</code></li><li>Screenshot the Galaxy and read its error logs</li><li>Report what's wrong</li></ol>
        <div class="small muted">Small steps run without asking. Anything that loses data asks again.</div>
      </div>
      <div class="calls">
        <div class="call"><svg data-i="checkCircle" class="ok"></svg><span class="fn">install_apk</span><span class="muted">app-debug.apk → 2 devices</span><span class="spacer"></span><span class="muted">41 s</span></div>
        <div class="call"><svg data-i="checkCircle" class="ok"></svg><span class="fn">open_deep_link</span><span class="muted">shop://cart → 2 devices</span><span class="spacer"></span><span class="muted">2 s</span></div>
        <div class="call"><svg data-i="checkCircle" class="ok"></svg><span class="fn">screenshot</span><span class="muted">Galaxy S23</span><span class="spacer"></span><span class="thumbshot" style="--accent:#5a4b8a"><span></span></span></div>
        <div class="call"><svg data-i="checkCircle" class="ok"></svg><span class="fn">read_logcat</span><span class="muted">Galaxy S23 · ReactNativeJS:E · last 60 s</span><span class="spacer"></span><span class="muted">14 lines</span></div>
      </div>
      <div class="msg-ai"><p>The cart crashes on the Galaxy with <code>TypeError: undefined is not an object (evaluating 'item.price.amount')</code> at <code>ProductRow.tsx:42</code>. The Galaxy has a cached cart item saved by 2.4.1 that has no <code>price</code> field. The Pixel starts with an empty cart, so it doesn't crash.</p><p>To confirm, I'd clear the app's data on the Galaxy and open the cart again.</p></div>
      <div class="approval" role="group" aria-label="Approval needed">
        <div class="row" style="gap:8px"><svg data-i="warn" style="color:var(--vscode-editorWarning-foreground)"></svg><strong style="color:var(--mota-heading)">Allow Claude to clear app data?</strong></div>
        <div class="small"><span class="mono">clear_app_data</span> · com.example.shop on <b>Galaxy S23</b>. This erases logins, cart and settings for this app on that phone.</div>
        <div class="row"><button class="btn btn-primary btn-sm">Allow once</button><button class="btn btn-secondary btn-sm">Allow for this conversation</button><button class="btn btn-ghost btn-sm">Deny</button></div>
      </div>
      <div class="calls"><div class="call"><svg data-i="spinner" class="run spin"></svg><span class="fn">read_logcat</span><span class="muted">Pixel 8 Pro · watching for errors…</span></div></div>
    </div>
    <div class="console-feed" id="console-feed" hidden>
      <pre class="output">$ adb -s 35161FDH2000GD shell dumpsys battery | grep level
  level: 82
$ adb -s R5CT20ABCDE shell dumpsys battery | grep level
  level: 64</pre>
    </div>
  </div>
  <div class="ai-bar">
    <div class="ai-input">
      <textarea id="ai-text" rows="1" placeholder="Ask Claude to install, test, debug or explore on your devices…" aria-label="Message Claude"></textarea>
      <div class="ai-meta">
        <div class="ai-mode" role="group" aria-label="Input mode">
          <button aria-pressed="true" data-mode="claude" title="Ask Claude"><svg data-i="sparkle"></svg>Claude</button>
          <button aria-pressed="false" data-mode="adb" title="Run ADB commands"><svg data-i="terminal"></svg>ADB</button>
        </div>
        <span class="ai-sep" aria-hidden="true"></span>
        <button class="scope" title="Devices Claude may act on"><svg data-i="phone"></svg>${scope}<svg data-i="chevronDown"></svg></button>
        <div class="cap-wrap" data-claude-only>
          <button class="scope" data-perm title="What Claude may do without asking"><svg data-i="shield"></svg>Ask once per task<svg data-i="chevronDown"></svg></button>
          <div class="cap-pop perm-pop" role="dialog" aria-label="Permissions" hidden>
            <label><input type="radio" name="perm" checked><span><b>Ask once per task</b><br><span class="muted">Approve a plan of steps and devices; its small steps then run without asking. Data loss always asks again.</span></span></label>
            <label><input type="radio" name="perm"><span><b>Ask only for data loss</b><br><span class="muted">Everything runs straight away except uninstall, clear data, reboot and file overwrites.</span></span></label>
            <label><input type="radio" name="perm"><span><b>Read-only</b><br><span class="muted">Screenshots, logs, metrics and device info only. Claude can't tap, install or change anything.</span></span></label>
          </div>
        </div>
        <div class="cap-wrap" data-claude-only>
          <button class="scope" data-cap title="Token limit for this task"><svg data-i="gauge"></svg>≤ 40K tokens<svg data-i="chevronDown"></svg></button>
          <div class="cap-pop" role="dialog" aria-label="Token limit" hidden>
            <div class="small muted" style="padding: 4px 8px 6px">Claude stops and asks before going over this limit.</div>
            <label><input type="radio" name="cap"><span><b>15K</b> · a quick question or action <span class="muted">(usually 5–15K)</span></span></label>
            <label><input type="radio" name="cap" checked><span><b>40K</b> · a task, or diagnosing one failure <span class="muted">(15–40K)</span></span></label>
            <label><input type="radio" name="cap"><span><b>150K</b> · write or fix one flow <span class="muted">(60–150K)</span></span></label>
            <label><input type="radio" name="cap"><span><b>300K</b> · explore the app for about 10 minutes <span class="muted">(200K+)</span></span></label>
            <label><input type="radio" name="cap"><span>Custom <input class="input" style="height:22px;width:90px;margin-left:6px" placeholder="e.g. 750K" aria-label="Custom token limit"></span></label>
          </div>
        </div>
        <span class="spacer"></span>
        <button class="scope ghost" data-claude-only id="ai-model" title="Model · signed in with your Claude Code login">Opus 5.5<svg data-i="chevronDown"></svg></button>
        <button class="send" aria-label="Send" title="Send (Enter) · new line (Shift+Enter)"><svg data-i="send"></svg></button>
      </div>
    </div>
  </div>`;
  if (el.hasAttribute('data-open')) el.classList.add('open');
  const scrollFeed = () => { const f = el.querySelector('#ai-feed'); f.scrollTop = f.scrollHeight; };
  requestAnimationFrame(scrollFeed);
  const text = el.querySelector('#ai-text');
  text.addEventListener('input', () => { text.style.height = 'auto'; text.style.height = Math.min(text.scrollHeight, 160) + 'px'; });
  text.addEventListener('focus', () => { el.classList.add('open'); requestAnimationFrame(scrollFeed); });
  el.addEventListener('click', e => {
    if (e.target.closest('[data-ai="collapse"]')) { el.classList.remove('open'); return; }
    const opener = e.target.closest('[data-cap],[data-perm]');
    el.querySelectorAll('.cap-pop').forEach(pop => { if (!pop.contains(e.target)) pop.hidden = !(opener && opener.parentElement.contains(pop)) || !pop.hidden; });
    if (opener) return;
    const m = e.target.closest('[data-mode]'); if (!m) return;
    const adb = m.dataset.mode === 'adb';
    el.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b === m)));
    el.querySelector('#ai-feed').hidden = adb; el.querySelector('#console-feed').hidden = !adb;
    el.querySelector('#ai-title').textContent = adb ? 'ADB console' : 'Claude';
    el.querySelector('#ai-sub').textContent = adb ? 'Runs on ' + scope : 'Cart crash check · 2 devices';
    el.querySelectorAll('[data-claude-only]').forEach(x => x.hidden = adb);
    text.placeholder = adb ? 'adb command, e.g. shell getprop ro.build.version.release' : 'Ask Claude to install, test, debug or explore on your devices…';
    text.classList.toggle('mono', adb);
    el.classList.add('open'); drawIcons(el);
  });
}
document.addEventListener('DOMContentLoaded', () => { document.querySelectorAll('.ai-dock').forEach(claudeDock); drawIcons(); });
