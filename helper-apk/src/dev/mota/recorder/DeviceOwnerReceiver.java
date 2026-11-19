package dev.mota.recorder;
import android.app.admin.DeviceAdminReceiver;
import android.content.ComponentName;
import android.content.Context;

/** Device-admin component. Becomes device owner only through setup-time QR provisioning (or `dpm set-device-owner` where the OEM allows it). */
public class DeviceOwnerReceiver extends DeviceAdminReceiver {
    static ComponentName component(Context c){return new ComponentName(c,DeviceOwnerReceiver.class);}
}
