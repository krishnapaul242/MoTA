package dev.mota.recorder;
import android.content.*;
import android.database.*;
import android.net.Uri;
import android.os.Binder;
import android.util.Base64;
import org.json.JSONObject;
/** Bootstrap is restricted to ADB shell/root AND Android's DUMP permission. */
public class BridgeProvider extends ContentProvider {
    @Override public boolean onCreate(){return true;}
    @Override public Cursor query(Uri uri,String[] projection,String selection,String[] args,String order){
        int uid=Binder.getCallingUid();
        if(uid!=2000&&uid!=0)throw new SecurityException("ADB shell required");
        if(!"/bootstrap".equals(uri.getPath()))throw new IllegalArgumentException("Unknown path");
        try{
            Bridge bridge=Bridge.ensure(getContext());
            JSONObject data=new JSONObject().put("protocol",1).put("version","0.2.2").put("socket","mota.recorder")
                .put("token",bridge.token).put("ready",RecorderService.live!=null);
            MatrixCursor cursor=new MatrixCursor(new String[]{"bridge"});
            cursor.addRow(new Object[]{Base64.encodeToString(data.toString().getBytes("UTF-8"),Base64.NO_WRAP)});return cursor;
        }catch(Exception e){throw new IllegalStateException("Bridge unavailable",e);}
    }
    @Override public String getType(Uri u){return "application/json";}
    @Override public Uri insert(Uri u,ContentValues v){throw new UnsupportedOperationException();}
    @Override public int delete(Uri u,String s,String[] a){throw new UnsupportedOperationException();}
    @Override public int update(Uri u,ContentValues v,String s,String[] a){throw new UnsupportedOperationException();}
}
