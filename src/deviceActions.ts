import { Adb } from './adb';
import { validPackage } from './apk';
export async function launchApp(adb: Adb, serial: string, pkg: string, user = 'current') {
  if (!validPackage(pkg)) throw new Error('Enter a valid app package ID to launch.');
  if (!/^(?:current|\d+)$/.test(user)) throw new Error('Choose current or a numeric Android user to launch an app.');
  const resolved = await adb.shell(serial,['cmd','package','resolve-activity','--brief','--user',user,'-a','android.intent.action.MAIN','-c','android.intent.category.LAUNCHER','-p',pkg]);
  const component = resolved.split(/\r?\n/).map(l => l.trim()).find(l => /^[\w.]+\/[\w.$]+$/.test(l) && l.split('/')[0] === pkg);
  if (!component) throw new Error(`${pkg} has no launcher activity for Android user ${user}. Check that it is installed and enabled.`);
  const result = await adb.shell(serial,['am','start','-W','--user',user,'-a','android.intent.action.MAIN','-c','android.intent.category.LAUNCHER','-n',component.includes('$') ? `'${component}'` : component]);
  if (/Error:|Exception|Permission Denial|Status:\s*(?!ok\b)\w+/i.test(result)) throw new Error(result);
  if (!/Status:\s*ok|Activity not started.*(?:brought to the front|delivered)/i.test(result)) throw new Error(result || 'Android did not confirm that the app launched.');
  return `${pkg} launched.`;
}
export async function setStayAwake(adb: Adb, serial: string, value: number) {
  if (!Number.isInteger(value) || value < 0 || value > 15) throw new Error('Invalid keep-awake setting.');
  const result = await adb.shell(serial,['settings','put','global','stay_on_while_plugged_in',String(value)]);
  if (/error|exception|permission denial/i.test(result)) throw new Error(result);
  const current = await adb.shell(serial,['settings','get','global','stay_on_while_plugged_in']);
  if (current.trim() !== String(value)) throw new Error('Android did not apply the keep-awake setting. Device policy may restrict it.');
}
export async function setScreenTimeout(adb: Adb, serial: string, milliseconds: number) {
  if (!Number.isInteger(milliseconds) || milliseconds < 0 || milliseconds > 2147483647) throw new Error('Invalid screen timeout.');
  const result = await adb.shell(serial,['settings','put','system','screen_off_timeout',String(milliseconds)]);
  if (/error|exception|permission denial/i.test(result)) throw new Error(result);
  const current = await adb.shell(serial,['settings','get','system','screen_off_timeout']);
  if (current.trim() !== String(milliseconds)) throw new Error('Android did not apply the screen timeout. Device policy may restrict it.');
}
