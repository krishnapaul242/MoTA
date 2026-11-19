package dev.mota.recorder;
import android.app.PendingIntent;
import android.app.admin.DevicePolicyManager;
import android.app.admin.SystemUpdatePolicy;
import android.content.*;
import android.content.pm.PackageInstaller;
import android.os.*;
import android.provider.Settings;
import android.util.Base64;
import org.json.*;
import java.io.*;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Device-owner operations for the authenticated ADB bridge ("admin*" ops). They replace ADB features that
 * Xiaomi gates behind "USB debugging (Security settings)": silent install/uninstall, runtime permission grants,
 * stay-awake and lock-screen control, system update deferral and reboot. Input injection is not available to
 * device owners and stays with the accessibility service.
 */
final class DeviceOwner {
    static final Map<String,JSONObject> results=new ConcurrentHashMap<>();
    static final String PACKAGE="[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z][A-Za-z0-9_]*)+";
    static final int MAX_CHUNK=4*1024*1024;

    static boolean handles(String op){return op.startsWith("admin");}

    static JSONObject handle(Context c,String op,JSONObject p)throws Exception{
        DevicePolicyManager dpm=c.getSystemService(DevicePolicyManager.class);
        ComponentName admin=DeviceOwnerReceiver.component(c);
        if(op.equals("adminStatus"))return status(c,dpm,admin);
        if(!dpm.isDeviceOwnerApp(c.getPackageName()))throw new IOException("MoTA Recorder is not device owner. Factory reset the phone and provision it with the MoTA QR code.");
        PackageInstaller installer=c.getPackageManager().getPackageInstaller();
        switch(op){
            case "adminInstallBegin":{
                long size=p.optLong("size",-1);if(size<=0||size>4L*1024*1024*1024)throw new IOException("Invalid APK size");
                PackageInstaller.SessionParams params=new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
                params.setSize(size);
                String pkg=p.optString("packageName");if(!pkg.isEmpty()){checkPackage(pkg);params.setAppPackageName(pkg);}
                if(Build.VERSION.SDK_INT>=31)params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
                int id=installer.createSession(params);
                return new JSONObject().put("session",id);
            }
            case "adminInstallWrite":{
                int id=p.getInt("session");String name=p.optString("name","base.apk");
                if(!name.matches("[A-Za-z0-9_.-]{1,100}\\.apk"))throw new IOException("Invalid APK name");
                long offset=p.getLong("offset");if(offset<0)throw new IOException("Invalid offset");
                byte[] data=Base64.decode(p.getString("data"),Base64.DEFAULT);if(data.length==0||data.length>MAX_CHUNK)throw new IOException("Chunk must be 1 byte to 4 MiB");
                try(PackageInstaller.Session session=installer.openSession(id);OutputStream out=session.openWrite(name,offset,-1)){
                    out.write(data);session.fsync(out);
                }
                return new JSONObject().put("session",id).put("written",offset+data.length);
            }
            case "adminInstallCommit":{
                int id=p.getInt("session");String key="install:"+id;results.put(key,new JSONObject().put("state","pending"));
                try(PackageInstaller.Session session=installer.openSession(id)){session.commit(resultSender(c,key));}
                catch(Exception e){results.remove(key);throw e;}
                return new JSONObject().put("session",id).put("state","pending");
            }
            case "adminInstallAbandon":installer.abandonSession(p.getInt("session"));results.remove("install:"+p.getInt("session"));return new JSONObject().put("state","abandoned");
            case "adminInstallResult":return result("install:"+p.getInt("session"));
            case "adminUninstall":{
                String pkg=p.getString("packageName");checkPackage(pkg);
                if(pkg.equals(c.getPackageName()))throw new IOException("Use adminRelease before removing MoTA Recorder");
                String key="uninstall:"+pkg;results.put(key,new JSONObject().put("state","pending"));
                installer.uninstall(pkg,resultSender(c,key));
                return new JSONObject().put("packageName",pkg).put("state","pending");
            }
            case "adminUninstallResult":{String pkg=p.getString("packageName");checkPackage(pkg);return result("uninstall:"+pkg);}
            case "adminPermission":{
                String pkg=p.getString("packageName"),permission=p.getString("permission"),state=p.optString("state","granted");
                checkPackage(pkg);if(!permission.matches("[A-Za-z0-9_.]{1,200}"))throw new IOException("Invalid permission name");
                int grant=state.equals("granted")?DevicePolicyManager.PERMISSION_GRANT_STATE_GRANTED:state.equals("denied")?DevicePolicyManager.PERMISSION_GRANT_STATE_DENIED
                    :state.equals("default")?DevicePolicyManager.PERMISSION_GRANT_STATE_DEFAULT:-1;
                if(grant<0)throw new IOException("State must be granted, denied or default");
                // Validate first: on Android 10 an unknown permission or package makes the system call hang instead of failing.
                android.content.pm.PackageManager pm=c.getPackageManager();
                try{pm.getPackageInfo(pkg,0);}catch(android.content.pm.PackageManager.NameNotFoundException e){throw new IOException("Package not installed: "+pkg);}
                android.content.pm.PermissionInfo info;
                try{info=pm.getPermissionInfo(permission,0);}catch(android.content.pm.PackageManager.NameNotFoundException e){throw new IOException("Permission does not exist on Android "+Build.VERSION.RELEASE+": "+permission);}
                if(info.getProtection()!=android.content.pm.PermissionInfo.PROTECTION_DANGEROUS)throw new IOException(permission+" is not a runtime permission");
                if(!dpm.setPermissionGrantState(admin,pkg,permission,grant))throw new IOException("Android refused to change "+permission+" (not a runtime permission, not requested by the app, or restricted by the OS)");
                return new JSONObject().put("packageName",pkg).put("permission",permission).put("state",dpm.getPermissionGrantState(admin,pkg,permission));
            }
            case "adminStayAwake":{
                // 7 = stay on while charging over AC, USB or wireless.
                dpm.setGlobalSetting(admin,Settings.Global.STAY_ON_WHILE_PLUGGED_IN,p.getBoolean("enabled")?"7":"0");
                return status(c,dpm,admin);
            }
            case "adminKeyguard":{
                boolean disabled=p.getBoolean("disabled");
                if(!dpm.setKeyguardDisabled(admin,disabled))throw new IOException("Remove the PIN, pattern or password before disabling the lock screen");
                return status(c,dpm,admin);
            }
            case "adminUpdatePolicy":{
                String policy=p.getString("policy");SystemUpdatePolicy value;
                switch(policy){
                    case "postpone":value=SystemUpdatePolicy.createPostponeInstallPolicy();break;
                    case "window":value=SystemUpdatePolicy.createWindowedInstallPolicy(minutes(p,"startMinute"),minutes(p,"endMinute"));break;
                    case "default":value=null;break;
                    default:throw new IOException("Policy must be postpone, window or default");
                }
                dpm.setSystemUpdatePolicy(admin,value);
                return status(c,dpm,admin);
            }
            case "adminLock":dpm.lockNow();return new JSONObject().put("locked",true);
            case "adminReboot":
                // Reply first; the reboot follows shortly.
                new Handler(Looper.getMainLooper()).postDelayed(()->{try{dpm.reboot(admin);}catch(Exception ignored){}},1000);
                return new JSONObject().put("rebooting",true);
            case "adminRelease":{
                if(!"release".equals(p.optString("confirm")))throw new IOException("Pass confirm: \"release\" to remove device owner");
                try{dpm.setKeyguardDisabled(admin,false);}catch(Exception ignored){}
                try{dpm.setSystemUpdatePolicy(admin,null);}catch(Exception ignored){}
                dpm.clearDeviceOwnerApp(c.getPackageName());
                return status(c,dpm,admin);
            }
            default:throw new IOException("Unknown command");
        }
    }

    static JSONObject status(Context c,DevicePolicyManager dpm,ComponentName admin)throws Exception{
        boolean owner=dpm.isDeviceOwnerApp(c.getPackageName());
        JSONObject r=new JSONObject().put("deviceOwner",owner).put("adminActive",dpm.isAdminActive(admin))
            .put("sdk",Build.VERSION.SDK_INT).put("manufacturer",Build.MANUFACTURER).put("model",Build.MODEL)
            .put("accessibilityReady",RecorderService.live!=null)
            .put("stayAwake",Settings.Global.getInt(c.getContentResolver(),Settings.Global.STAY_ON_WHILE_PLUGGED_IN,0)!=0);
        if(owner){SystemUpdatePolicy policy=dpm.getSystemUpdatePolicy();r.put("updatePolicy",policy==null?"default":policy.getPolicyType()==SystemUpdatePolicy.TYPE_POSTPONE?"postpone":policy.getPolicyType()==SystemUpdatePolicy.TYPE_INSTALL_WINDOWED?"window":"automatic");}
        return r;
    }

    static JSONObject result(String key)throws Exception{
        JSONObject r=results.get(key);if(r==null)return new JSONObject().put("state","unknown");
        if(!"pending".equals(r.optString("state")))results.remove(key);
        return r;
    }

    static IntentSender resultSender(Context c,String key){
        if(results.size()>200)results.clear();
        Intent intent=new Intent(c,InstallResultReceiver.class).putExtra("mota.key",key);
        intent.setIdentifier(key); // Distinct PendingIntent per operation.
        // Mutable so PackageInstaller can add its status extras; the intent is explicit, as Android 14 requires.
        return PendingIntent.getBroadcast(c,0,intent,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_MUTABLE).getIntentSender();
    }

    static void checkPackage(String pkg)throws IOException{if(pkg.length()>255||!pkg.matches(PACKAGE))throw new IOException("Invalid package name");}
    static int minutes(JSONObject p,String key)throws Exception{int m=p.getInt(key);if(m<0||m>=1440)throw new IOException(key+" must be 0-1439");return m;}
}
