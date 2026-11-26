package dev.mota.load;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Binder;
import android.os.Bundle;
import org.json.JSONObject;

/**
 * How MoTA drives a load app: `adb shell content call --uri content://<package>.ctl --method set --arg '<json>'`.
 * Restricted to ADB shell/root and Android's DUMP permission. A call starts the app when it is not running.
 */
public class ControlProvider extends ContentProvider {
    static final String PREFS = "load", KEY = "config";

    @Override public boolean onCreate() {
        // An app that was told to come back after being killed picks its load up again when its process restarts.
        Context c = getContext();
        String saved = c.getSharedPreferences(PREFS, 0).getString(KEY, null);
        if (saved != null) try { Engine.I.apply(c, new JSONObject(saved)); } catch (Exception ignored) { }
        return true;
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
                Intent intent = new Intent(c, LoadService.class);
                if (service) c.startForegroundService(intent); else c.stopService(intent);
            } else if ("stop".equals(method)) {
                c.getSharedPreferences(PREFS, 0).edit().remove(KEY).commit();
                Engine.I.apply(c, new JSONObject());
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
