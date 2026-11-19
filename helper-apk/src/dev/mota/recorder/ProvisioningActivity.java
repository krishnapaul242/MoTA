package dev.mota.recorder;
import android.app.Activity;
import android.app.admin.DevicePolicyManager;
import android.content.Intent;
import android.os.Bundle;

/**
 * Required by Android 12+ setup-time provisioning. GET_PROVISIONING_MODE picks a fully managed device;
 * ADMIN_POLICY_COMPLIANCE finishes immediately because MoTA applies no policies until the desktop asks for them.
 * Only the system can start it (BIND_DEVICE_ADMIN).
 */
public class ProvisioningActivity extends Activity {
    @Override protected void onCreate(Bundle state){
        super.onCreate(state);
        Intent result=new Intent();
        if(DevicePolicyManager.ACTION_GET_PROVISIONING_MODE.equals(getIntent().getAction()))
            result.putExtra(DevicePolicyManager.EXTRA_PROVISIONING_MODE,DevicePolicyManager.PROVISIONING_MODE_FULLY_MANAGED_DEVICE);
        setResult(RESULT_OK,result);finish();
    }
}
