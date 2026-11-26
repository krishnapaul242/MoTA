package dev.mota.load;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.os.IBinder;

/** Keeps the app working in the background, like a music player or a sync: Android kills it after apps that are only open in recents. */
public class LoadService extends Service {
    static volatile boolean running;

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override public int onStartCommand(Intent intent, int flags, int id) {
        running = true;
        getSystemService(NotificationManager.class).createNotificationChannel(new NotificationChannel("load", "Load", NotificationManager.IMPORTANCE_MIN));
        startForeground(1, new Notification.Builder(this, "load").setSmallIcon(android.R.drawable.stat_notify_sync).setContentTitle(getApplicationInfo().loadLabel(getPackageManager())).setContentText("MoTA load app is running").build());
        // Sticky: Android starts the service again after killing the app, as it does for real background apps.
        return Engine.I.config().optBoolean("respawn") ? START_STICKY : START_NOT_STICKY;
    }

    @Override public void onDestroy() { running = false; super.onDestroy(); }
}
