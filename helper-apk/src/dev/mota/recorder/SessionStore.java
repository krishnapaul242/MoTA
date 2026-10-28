package dev.mota.recorder;

import android.content.Context;
import android.os.SystemClock;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.*;
import java.util.zip.*;

/** Local, versioned recording. Times are monotonic milliseconds relative to start. */
final class SessionStore {
    final File dir;
    final JSONObject data;
    final JSONArray actions;
    final long origin;
    private long pausedAt, pausedTotal;

    SessionStore(Context context, int width, int height, int rotation) throws Exception {
        String id = new SimpleDateFormat("yyyyMMdd-HHmmss-SSS", Locale.US).format(new Date());
        dir = new File(root(context), id);
        if (!dir.mkdirs()) throw new IOException("Cannot create session");
        actions = new JSONArray();
        data = new JSONObject().put("schemaVersion", 1).put("id", id)
            .put("createdAt", new Date().toString()).put("width", width).put("height", height)
            .put("rotation", rotation).put("captureMode", "overlay-then-dispatch")
            .put("actions", actions).put("screenshots", new JSONArray()).put("notes", new JSONArray())
            .put("videoStatus", "not-requested");
        origin = SystemClock.elapsedRealtime();
        data.put("uptimeStartMs",SystemClock.uptimeMillis());
        save();
    }
    static File root(Context c) { File f = new File(c.getFilesDir(), "sessions"); f.mkdirs(); return f; }
    static File[] list(Context c) {
        File[] fs = root(c).listFiles(File::isDirectory);
        if (fs == null) return new File[0];
        Arrays.sort(fs, (a,b) -> b.getName().compareTo(a.getName()));
        return fs;
    }
    static JSONObject read(File dir) throws Exception {
        try (InputStream in = new FileInputStream(new File(dir, "actions.json"))) {
            ByteArrayOutputStream out = new ByteArrayOutputStream(); byte[] b = new byte[8192]; int n;
            while ((n = in.read(b)) != -1) out.write(b,0,n);
            return new JSONObject(out.toString("UTF-8"));
        }
    }
    long now() { return (pausedAt == 0 ? SystemClock.elapsedRealtime() : pausedAt) - origin - pausedTotal; }
    void pause() { if (pausedAt == 0) { pausedAt = SystemClock.elapsedRealtime(); note("Paused at wallMs="+(pausedAt-origin)); } }
    void resume() { if (pausedAt != 0) { pausedTotal += SystemClock.elapsedRealtime()-pausedAt; pausedAt=0; note("Resumed at wallMs="+(SystemClock.elapsedRealtime()-origin)); } }
    synchronized int add(JSONObject event) throws Exception { actions.put(event); save(); return actions.length()-1; }
    synchronized void note(String value) {
        try { data.getJSONArray("notes").put(new JSONObject().put("atMs",now()).put("message",value)); save(); }
        catch (Exception ignored) { android.util.Log.e("MoTA", "Could not save session note", ignored); }
    }
    synchronized void screenshot(String file, long at, int action) throws Exception {
        data.getJSONArray("screenshots").put(new JSONObject().put("file",file).put("atMs",at).put("actionIndex",action).put("wallAtMs",SystemClock.elapsedRealtime()-origin)); save();
    }
    synchronized void set(String key, Object value) throws Exception { data.put(key,value); save(); }
    synchronized void save() throws Exception {
        File tmp = new File(dir, "actions.json.tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) { out.write(data.toString(2).getBytes(StandardCharsets.UTF_8)); out.getFD().sync(); }
        if (!tmp.renameTo(new File(dir,"actions.json"))) throw new IOException("Cannot persist actions.json");
    }
    static void export(File dir, OutputStream output) throws Exception {
        try (ZipOutputStream zip = new ZipOutputStream(output)) { zipFiles(dir,dir,zip); }
    }
    private static void zipFiles(File root, File dir, ZipOutputStream zip) throws Exception {
        File[] fs = dir.listFiles(); if(fs == null) throw new IOException("Cannot list session");
        byte[] buffer = new byte[16384];
        for(File f: fs) {
            if(f.isDirectory()) { zipFiles(root,f,zip); continue; }
            if(f.getName().endsWith(".tmp")) continue;
            String name = f.getAbsolutePath().substring(root.getAbsolutePath().length()+1);
            zip.putNextEntry(new ZipEntry(name));
            try(InputStream in = new FileInputStream(f)) { int n; while((n=in.read(buffer))!=-1) zip.write(buffer,0,n); }
            zip.closeEntry();
        }
    }
}
