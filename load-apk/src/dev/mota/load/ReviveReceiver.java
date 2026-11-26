package dev.mota.load;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Fires every 10 s while the app is told to come back: starts it again if Android killed it, and sets the next alarm. */
public class ReviveReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) { ControlProvider.resume(context); }
}
