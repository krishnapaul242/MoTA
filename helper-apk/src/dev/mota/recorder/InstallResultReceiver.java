package dev.mota.recorder;
import android.content.*;
import android.content.pm.PackageInstaller;
import org.json.JSONObject;

/** Receives PackageInstaller results for device-owner installs and uninstalls. Not exported; reached only through MoTA's own PendingIntents. */
public class InstallResultReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context c,Intent intent){
        String key=intent.getStringExtra("mota.key");if(key==null)return;
        int status=intent.getIntExtra(PackageInstaller.EXTRA_STATUS,PackageInstaller.STATUS_FAILURE);
        try{
            JSONObject r=new JSONObject().put("status",status)
                .put("state",status==PackageInstaller.STATUS_SUCCESS?"success":status==PackageInstaller.STATUS_PENDING_USER_ACTION?"needsUserAction":"failed");
            String message=intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);if(message!=null)r.put("message",message);
            String pkg=intent.getStringExtra(PackageInstaller.EXTRA_PACKAGE_NAME);if(pkg!=null)r.put("packageName",pkg);
            DeviceOwner.results.put(key,r);
        }catch(Exception ignored){}
    }
}
