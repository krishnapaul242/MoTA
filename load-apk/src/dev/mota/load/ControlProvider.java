package dev.mota.load;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Binder;
import android.os.Bundle;
import android.os.SystemClock;
import org.json.JSONObject;

/**
 * How MoTA drives a load app: `adb shell content call --uri content://<package>.ctl --method set --arg '<json>'`.
 * Restricted to ADB shell/root and Android's DUMP permission. A call starts the app when it is not running.
 */
public class ControlProvider extends ContentProvider {
    static final String PREFS = "load", KEY = "config";

    @Override public boolean onCreate() {
        // An app that was told to come back after being killed picks its load up again when its process restarts.
        resume(getContext());
        return true;
    }

    /** Takes up the saved load again, if this app was told to come back and has lost it. Returns whether it is to come back. */
    static boolean resume(Context c) {
        String saved = c.getSharedPreferences(PREFS, 0).getString(KEY, null);
        if (saved == null) return false;
        try {
            if (Engine.I.config().length() == 0) Engine.I.apply(c, new JSONObject(saved));
            if (!LoadService.running) c.startForegroundService(new Intent(c, LoadService.class));
        } catch (Exception ignored) { }
        watch(c, true);
        return true;
    }

    /**
     * Android does not reliably restart a service it killed for low memory, so an alarm brings the app back,
     * the way alarms, jobs and push messages bring real apps back.
     */
    static void watch(Context c, boolean on) {
        AlarmManager alarms = c.getSystemService(AlarmManager.class);
        PendingIntent revive = PendingIntent.getBroadcast(c, 0, new Intent(c, ReviveReceiver.class), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        if (on) alarms.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, SystemClock.elapsedRealtime() + 10_000, revive);
        else alarms.cancel(revive);
    }

    @Override public Bundle call(String method, String arg, Bundle extras) {
        int uid = Binder.getCallingUid();
        if (uid != 2000 && uid != 0) throw new SecurityException("ADB shell required");
        Context c = getContext();
        Bundle out = new Bundle();
        try {
            if ("set".equals(method)) {
                JSONObject cfg = new JSONObject(arg == null ? "{}" : arg);
                boolean service = "service".equals(cfg.optString("state")), respawn = service && cfg.optBoolean("respawn");
                if (respawn) c.getSharedPreferences(PREFS, 0).edit().putString(KEY, cfg.toString()).commit();
                else c.getSharedPreferences(PREFS, 0).edit().remove(KEY).commit();
                Engine.I.apply(c, cfg);
                watch(c, respawn);
                Intent intent = new Intent(c, LoadService.class);
                if (service) c.startForegroundService(intent); else c.stopService(intent);
            } else if ("stop".equals(method)) {
                c.getSharedPreferences(PREFS, 0).edit().remove(KEY).commit();
                Engine.I.apply(c, new JSONObject());
                watch(c, false);
                c.stopService(new Intent(c, LoadService.class));
            } else if (!"status".equals(method)) throw new IllegalArgumentException("Unknown method " + method);
            out.putString("json", Engine.I.status(c).toString());
        } catch (Exception e) { out.putString("json", "{\"error\":" + JSONObject.quote(String.valueOf(e)) + "}"); }
        return out;
    }

    @Override public Cursor query(Uri u, String[] p, String s, String[] a, String o) { throw new UnsupportedOperationException(); }
    @Override public String getType(Uri u) { return null; }
    @Override public Uri insert(Uri u, ContentValues v) { throw new UnsupportedOperationException(); }
    @Override public int delete(Uri u, String s, String[] a) { throw new UnsupportedOperationException(); }
    @Override public int update(Uri u, ContentValues v, String s, String[] a) { throw new UnsupportedOperationException(); }
}
