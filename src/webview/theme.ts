/**
 * Shared look for MoTA webviews (approved design in design-mockups/).
 * Colours come from the active VS Code theme (--vscode-*); --mota-* tokens are derived from them,
 * so dark, light and high-contrast themes all work without separate palettes.
 */
export const themeStyles = `
:root{
 --mota-heading:var(--vscode-editor-foreground,var(--vscode-foreground));
 --mota-stage:color-mix(in srgb,var(--vscode-editor-background) 72%,#000);
 --mota-bezel:var(--vscode-widget-border,var(--vscode-panel-border));
 --mota-overlay:color-mix(in srgb,#000 72%,transparent);
 --mota-overlay-fg:#e7e7e7;
 --mota-shadow:0 8px 24px var(--vscode-widget-shadow,rgba(0,0,0,.36));
 --mota-live-bg:color-mix(in srgb,var(--vscode-charts-blue) 16%,transparent);
 --mota-live-fg:var(--vscode-charts-blue);
 --mota-danger-border:color-mix(in srgb,var(--vscode-errorForeground) 45%,transparent);
}
body.vscode-light{--mota-stage:color-mix(in srgb,var(--vscode-editor-background) 90%,#000);--mota-overlay:color-mix(in srgb,#fff 90%,transparent);--mota-overlay-fg:#1f1f1f}
*{box-sizing:border-box}
html,body{height:100%}
body{margin:0;padding:0;background:var(--vscode-editor-background);color:var(--vscode-foreground);font-family:var(--vscode-font-family,system-ui);font-size:13px;line-height:1.4}
h1,h2,h3{margin:0;color:var(--mota-heading);font-weight:600}
h1{font-size:20px}h2{font-size:14px}h3{font-size:13px}
a{color:var(--vscode-textLink-foreground)}
code,.mono{font-family:var(--vscode-editor-font-family,monospace);font-size:12px}
.muted{color:var(--vscode-descriptionForeground)}
.small{font-size:12px}
.row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.spacer{flex:1}
[hidden]{display:none!important}
.page{max-width:1440px;margin:0 auto;padding:20px 24px 24px;display:flex;flex-direction:column;gap:16px;width:100%}
.page-header{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px}
.subtitle{font-size:12px;color:var(--vscode-descriptionForeground);margin-top:2px}
.divider{width:1px;height:20px;background:var(--vscode-widget-border,var(--vscode-panel-border));margin:0 4px}
svg.i{width:16px;height:16px;flex:none;fill:none;stroke:currentColor;stroke-width:1.3;stroke-linecap:round;stroke-linejoin:round}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:28px;padding:0 12px;border-radius:4px;border:1px solid transparent;font:inherit;cursor:pointer;white-space:nowrap;text-decoration:none}
.btn:disabled{opacity:.5;cursor:default}
.btn:focus-visible,.icon-btn:focus-visible,.tool:focus-visible,.seg button:focus-visible,.tabs button:focus-visible,.scope:focus-visible,.send:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:2px}
.btn-primary{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}
.btn-primary:hover:not(:disabled){background:var(--vscode-button-hoverBackground)}
.btn-secondary{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border-color:var(--vscode-input-border,transparent)}
.btn-secondary:hover:not(:disabled){background:var(--vscode-button-secondaryHoverBackground)}
.btn-ghost{background:transparent;color:var(--vscode-foreground)}
.btn-ghost:hover:not(:disabled),.icon-btn:hover:not(:disabled),.tool:hover:not(:disabled){background:var(--vscode-toolbar-hoverBackground)}
.btn-danger{background:transparent;color:var(--vscode-errorForeground);border-color:var(--mota-danger-border)}
.btn-sm{height:24px;padding:0 8px;font-size:12px}
.icon-btn{width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;border-radius:4px;background:transparent;border:0;color:var(--vscode-foreground);cursor:pointer;padding:0}
.tool{width:36px;height:36px;display:inline-flex;align-items:center;justify-content:center;border-radius:6px;background:transparent;border:0;color:var(--vscode-foreground);cursor:pointer;padding:0}
.tool svg.i{width:18px;height:18px;stroke-width:1.2}
.input,.select{height:28px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,var(--vscode-panel-border));border-radius:4px;color:var(--vscode-input-foreground,var(--vscode-foreground));padding:0 8px;font:inherit}
.input:focus,.select:focus{outline:1px solid var(--vscode-focusBorder);outline-offset:-1px}
.input::placeholder{color:var(--vscode-input-placeholderForeground)}
.search{display:flex;align-items:center;gap:6px;height:28px;padding:0 8px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,var(--vscode-panel-border));border-radius:4px;color:var(--vscode-descriptionForeground)}
.search:focus-within{outline:1px solid var(--vscode-focusBorder);outline-offset:-1px}
.search input{flex:1;min-width:0;background:transparent;border:0;color:var(--vscode-input-foreground,var(--vscode-foreground));font:inherit;outline:none}
.field{display:flex;flex-direction:column;gap:4px;font-size:12px}
.field>span{color:var(--vscode-descriptionForeground)}
.check{display:inline-flex;align-items:center;gap:8px;cursor:pointer}
.check input{accent-color:var(--vscode-button-background);margin:0}
.seg{display:inline-flex;border:1px solid var(--vscode-input-border,var(--vscode-panel-border));border-radius:4px;overflow:hidden}
.seg button{background:transparent;border:0;color:var(--vscode-foreground);padding:0 10px;height:26px;font:inherit;font-size:12px;cursor:pointer;display:inline-flex;gap:6px;align-items:center}
.seg button+button{border-left:1px solid var(--vscode-input-border,var(--vscode-panel-border))}
.seg button[aria-pressed="true"]{background:var(--vscode-list-activeSelectionBackground);color:var(--vscode-list-activeSelectionForeground,var(--mota-heading));font-weight:600}
.seg .count{opacity:.75;font-weight:400}
.status{display:inline-flex;align-items:center;gap:6px;font-size:12px}
.dot{width:8px;height:8px;border-radius:50%;flex:none;display:inline-block}
.dot.ready{background:var(--vscode-testing-iconPassed,#3fb950)}
.dot.live{background:var(--vscode-charts-blue)}
.dot.warn{background:var(--vscode-editorWarning-foreground)}
.dot.off{background:#8b8b8b}
.dot.fail{background:var(--vscode-errorForeground)}
.pill{display:inline-flex;align-items:center;gap:6px;font-size:11px;padding:2px 8px;border-radius:10px;background:var(--mota-overlay);color:var(--mota-overlay-fg)}
.live-pill{display:inline-flex;align-items:center;gap:6px;font-size:11px;padding:2px 8px;border-radius:10px;background:var(--mota-live-bg);color:var(--mota-live-fg)}
.chip{display:inline-flex;align-items:center;gap:4px;font-size:12px;color:var(--vscode-descriptionForeground)}
.chip svg.i{width:13px;height:13px}
.chip.warn{color:var(--vscode-editorWarning-foreground)}
.badge{display:inline-flex;align-items:center;height:18px;padding:0 6px;border-radius:9px;font-size:11px;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground)}
.card{background:var(--vscode-sideBar-background,var(--vscode-editor-background));border:1px solid var(--vscode-panel-border);border-radius:8px}
.card-pad{padding:16px}
.section-title{font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--vscode-descriptionForeground)}
.tabs{display:flex;gap:2px;border-bottom:1px solid var(--vscode-panel-border);overflow-x:auto}
.tabs button{background:transparent;border:0;border-bottom:2px solid transparent;color:var(--vscode-descriptionForeground);padding:8px 12px;font:inherit;cursor:pointer;white-space:nowrap}
.tabs button[aria-selected="true"]{color:var(--mota-heading);border-bottom-color:var(--vscode-focusBorder)}
.floating-bar{position:sticky;bottom:16px;align-self:center;max-width:100%;display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:8px 8px 8px 14px;background:var(--vscode-editorWidget-background);border:1px solid var(--vscode-widget-border,var(--vscode-panel-border));border-radius:8px;box-shadow:var(--mota-shadow);z-index:15}
.menu{position:absolute;z-index:40;min-width:200px;padding:4px;background:var(--vscode-menu-background,var(--vscode-editorWidget-background));color:var(--vscode-menu-foreground,var(--vscode-foreground));border:1px solid var(--vscode-menu-border,var(--vscode-widget-border,var(--vscode-panel-border)));border-radius:6px;box-shadow:var(--mota-shadow);display:flex;flex-direction:column}
.menu button{display:flex;align-items:center;gap:8px;text-align:left;background:transparent;border:0;color:inherit;font:inherit;padding:6px 10px;border-radius:4px;cursor:pointer}
.menu button:hover,.menu button:focus-visible{background:var(--vscode-menu-selectionBackground,var(--vscode-list-hoverBackground));color:var(--vscode-menu-selectionForeground,inherit);outline:none}
.menu button.danger{color:var(--vscode-errorForeground)}
.menu hr{border:0;border-top:1px solid var(--vscode-menu-separatorBackground,var(--vscode-panel-border));margin:4px 0;width:100%}
.toast{position:fixed;right:16px;bottom:96px;z-index:60;display:flex;gap:10px;align-items:flex-start;max-width:440px;padding:10px 12px;background:var(--vscode-notifications-background,var(--vscode-editorWidget-background));color:var(--vscode-notifications-foreground,var(--vscode-foreground));border:1px solid var(--vscode-notifications-border,var(--vscode-widget-border,var(--vscode-panel-border)));border-radius:6px;box-shadow:var(--mota-shadow)}
.toast .ok{color:var(--vscode-testing-iconPassed,#3fb950)}.toast .bad{color:var(--vscode-errorForeground)}
pre.output{margin:0;padding:12px;background:var(--vscode-textCodeBlock-background);border-radius:6px;font-family:var(--vscode-editor-font-family,monospace);font-size:12px;overflow:auto;white-space:pre-wrap}
.modal{position:fixed;inset:0;z-index:50;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:20px}
.dialog{background:var(--vscode-editor-background);border:1px solid var(--vscode-widget-border,var(--vscode-panel-border));border-radius:10px;padding:18px 20px;width:min(580px,100%);max-height:100%;overflow:auto;box-shadow:var(--mota-shadow)}
.empty{padding:48px 24px;text-align:center;border:1px dashed var(--vscode-widget-border,var(--vscode-panel-border));border-radius:8px;display:flex;flex-direction:column;align-items:center;gap:10px}
.st{min-height:1.5em;font-size:12px}.st.ok{color:var(--vscode-testing-iconPassed,#3fb950)}.st.error{color:var(--vscode-errorForeground)}.st.working{color:var(--vscode-descriptionForeground)}
@keyframes mota-spin{to{transform:rotate(360deg)}}
.spin{animation:mota-spin 1s linear infinite}
@media (prefers-reduced-motion:reduce){.spin{animation:none}}
`;

/** 16×16 stroke icons. Names are referenced as <svg data-i="name"> in markup and by icon() on the host. */
export const ICONS: Record<string, string> = {
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
  sun: '<circle cx="8" cy="8" r="2.8"/><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1"/>',
  moon: '<path d="M13 9.5A5.5 5.5 0 1 1 6.5 3a4.5 4.5 0 0 0 6.5 6.5z"/>',
  camera: '<rect x="2" y="4.5" width="12" height="8.5" rx="1.5"/><circle cx="8" cy="8.7" r="2.3"/><path d="M6 4.5 7 3h2l1 1.5"/>',
  record: '<circle cx="8" cy="8" r="5.5"/><circle cx="8" cy="8" r="2.3" fill="currentColor"/>',
  more: '<circle cx="3.5" cy="8" r=".9" fill="currentColor"/><circle cx="8" cy="8" r=".9" fill="currentColor"/><circle cx="12.5" cy="8" r=".9" fill="currentColor"/>',
  close: '<path d="M4 4l8 8M12 4l-8 8"/>',
  warn: '<path d="M8 2 1.5 13.5h13z"/><path d="M8 6.5v3.2M8 11.6v.2"/>',
  error: '<circle cx="8" cy="8" r="6"/><path d="M8 4.8v3.6M8 10.9v.2"/>',
  check: '<path d="M3 8.5 6.5 12 13 4.5"/>',
  checkCircle: '<circle cx="8" cy="8" r="6"/><path d="M5.3 8.2 7.2 10l3.5-4"/>',
  volUp: '<path d="M2.5 6h2.5L8.5 3v10L5 10H2.5zM11 5.5a3.5 3.5 0 0 1 0 5M12.8 3.8a6 6 0 0 1 0 8.4"/>',
  volDown: '<path d="M2.5 6h2.5L8.5 3v10L5 10H2.5zM11 5.5a3.5 3.5 0 0 1 0 5"/>',
  keyboard: '<rect x="1.5" y="4" width="13" height="8" rx="1.5"/><path d="M4 7h1M7 7h1M10 7h1M5 9.5h6"/>',
  popout: '<path d="M9 2.5h4.5V7M13.5 2.5 8 8M6.5 3.5h-4v10h10v-4"/>',
  package: '<path d="M8 1.8 13.5 4.8v6.4L8 14.2 2.5 11.2V4.8zM2.5 4.8 8 7.8l5.5-3M8 7.8v6.4"/>',
  terminal: '<rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><path d="M4.5 6l2 2-2 2M8.5 10.5h3"/>',
  play: '<path d="M5 3.5v9l7-4.5z"/>',
  pause: '<path d="M5.5 3.5v9M10.5 3.5v9"/>',
  download: '<path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10"/>',
  upload: '<path d="M8 10.5v-8M4.5 6 8 2.5 11.5 6M3 13.5h10"/>',
  chevronDown: '<path d="M4 6l4 4 4-4"/>',
  chevronRight: '<path d="M6 4l4 4-4 4"/>',
  arrowLeft: '<path d="M13 8H3M7 4 3 8l4 4"/>',
  trash: '<path d="M3 4.5h10M6 4.5V3h4v1.5M4.5 4.5l.7 9h5.6l.7-9"/>',
  link: '<path d="M6.5 9.5l3-3M7 4.5l1-1a2.8 2.8 0 0 1 4 4l-1 1M9 11.5l-1 1a2.8 2.8 0 0 1-4-4l1-1"/>',
  folder: '<path d="M1.5 4.5V12a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1H8L6.5 3.5h-4a1 1 0 0 0-1 1z"/>',
  file: '<path d="M4 1.5h5.5L12.5 4.5V14.5h-8.5zM9.5 1.5v3h3"/>',
  activity: '<path d="M1.5 8.5h3l2-5 3 9 2-4h3"/>',
  logs: '<path d="M3 3.5h10M3 6.5h10M3 9.5h7M3 12.5h5"/>',
  info: '<circle cx="8" cy="8" r="6"/><path d="M8 7.2v3.8M8 5v.2"/>',
  settings: '<circle cx="8" cy="8" r="2"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"/>',
  copy: '<rect x="5" y="5" width="8.5" height="8.5" rx="1"/><path d="M3 10.5V3a.5.5 0 0 1 .5-.5H11"/>',
  sparkle: '<path d="M8 1.5c.4 3.3 1.9 4.9 5.5 5.5-3.6.6-5.1 2.2-5.5 5.5-.4-3.3-1.9-4.9-5.5-5.5 3.6-.6 5.1-2.2 5.5-5.5z"/><path d="M13 11.5c.15 1 .6 1.5 1.5 1.65-.9.15-1.35.6-1.5 1.6-.15-1-.6-1.45-1.5-1.6.9-.15 1.35-.65 1.5-1.65z"/>',
  send: '<path d="M8 13V3M3.5 7.5 8 3l4.5 4.5"/>',
  stop: '<rect x="4" y="4" width="8" height="8" rx="1" fill="currentColor"/>',
  spinner: '<path d="M8 2a6 6 0 1 1-6 6"/>',
  history: '<path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9M2.5 2.5v2.5H5M8 5v3l2 1.5"/>',
  shield: '<path d="M8 1.8 13 3.6v4c0 3.2-2.2 5.6-5 6.6-2.8-1-5-3.4-5-6.6v-4z"/>',
  gauge: '<path d="M2.5 11a5.5 5.5 0 1 1 11 0"/><path d="M8 11l2.5-3"/>',
  phone: '<rect x="4.5" y="1.5" width="7" height="13" rx="1.5"/><path d="M7 12.5h2"/>',
  flask: '<path d="M6 1.8h4M6.5 1.8v4L2.8 12.4a1.2 1.2 0 0 0 1 1.8h8.4a1.2 1.2 0 0 0 1-1.8L9.5 5.8v-4M4.6 9.5h6.8"/>',
  qr: '<rect x="2" y="2" width="4.5" height="4.5"/><rect x="9.5" y="2" width="4.5" height="4.5"/><rect x="2" y="9.5" width="4.5" height="4.5"/><path d="M9.5 9.5h2v2M14 9.5v4.5h-4.5M12 12h.01"/>',
};

/** Host-side icon markup. */
export function icon(name: string, extra = '') {
  return `<svg class="i" viewBox="0 0 16 16" aria-hidden="true"${extra ? ' ' + extra : ''}>${ICONS[name] ?? ''}</svg>`;
}

/** Client-side helper: fills <svg data-i="name"> placeholders (for markup built in the webview). */
export const iconScript = `
const ICONS=${JSON.stringify(ICONS)};
function icon(n,extra){return '<svg class="i" viewBox="0 0 16 16" aria-hidden="true"'+(extra?' '+extra:'')+'>'+(ICONS[n]||'')+'</svg>';}
function drawIcons(root){(root||document).querySelectorAll('svg[data-i]:not([data-drawn])').forEach(s=>{s.setAttribute('viewBox','0 0 16 16');s.setAttribute('aria-hidden','true');s.classList.add('i');s.innerHTML=ICONS[s.dataset.i]||'';s.dataset.drawn='1';});}
`;
