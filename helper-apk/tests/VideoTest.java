package dev.mota.recorder;

import android.app.*;
import android.content.*;
import android.os.*;
import android.view.accessibility.AccessibilityNodeInfo;
import android.media.MediaMetadataRetriever;
import org.json.JSONObject;
import java.io.File;

/** Exercises Android's actual consent UI and validates the resulting MP4. */
public class VideoTest extends SmokeTest {
    @Override public void onStart(){
        Bundle result=new Bundle();String labels="";
        try {
            automation=getUiAutomation(UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES);
            String enabled=android.provider.Settings.Secure.getString(getTargetContext().getContentResolver(),"enabled_accessibility_services");
            shell("settings put secure enabled_accessibility_services null");SystemClock.sleep(1500);
            shell("settings put secure enabled_accessibility_services "+enabled);shell("settings put secure accessibility_enabled 1");
            waitFor(()->RecorderService.live!=null,30000);service=RecorderService.live;
            shell("pm grant dev.mota.recorder android.permission.POST_NOTIFICATIONS");
            MainActivity app=(MainActivity)startActivitySync(new Intent(getTargetContext(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            waitForIdleSync();main(()->{service.hideControls();app.video.setChecked(true);app.newRecording();});
            long until=SystemClock.elapsedRealtime()+15000;
            boolean chosen=false;
            while(SystemClock.elapsedRealtime()<until&&!CaptureService.active){
                SystemClock.sleep(350);AccessibilityNodeInfo root=automation.getRootInActiveWindow();labels=labels(root);
                AccessibilityNodeInfo entire=findText(root,"Share entire screen");
                if(entire==null)entire=findText(root,"Entire screen");if(entire!=null&&!chosen){click(entire);chosen=true;continue;}
                AccessibilityNodeInfo single=findText(root,"A single app");
                if(single==null)single=findText(root,"Share one app");if(single!=null&&!chosen){click(single);SystemClock.sleep(200);continue;}
                AccessibilityNodeInfo start=findText(root,"Start now");if(start==null)start=findText(root,"Start");if(start==null)start=findText(root,"Share screen");if(start==null&&chosen)start=findText(root,"Next");
                if(start!=null)click(start);
            }
            if(!CaptureService.active)throw new AssertionError("Consent UI did not start capture: "+labels);
            waitFor(()->service.session!=null&&"recording".equals(service.session.data.optString("videoStatus")),10000);
            SystemClock.sleep(2200);final File dir=service.session.dir;main(()->service.stopEverything("Video smoke test saved"));
            waitFor(()->!CaptureService.active,10000);JSONObject data=SessionStore.read(dir);
            check("saved".equals(data.getString("videoStatus")),"Video finalized successfully");
            File file=new File(dir,"screen.mp4");check(file.length()>1000,"MP4 file has content");
            MediaMetadataRetriever metadata=new MediaMetadataRetriever();metadata.setDataSource(file.getAbsolutePath());
            String duration=metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
            check(Long.parseLong(duration)>=1500,"Video duration is at least 1.5 seconds");
            check(Integer.parseInt(metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH))>0,"Video has a valid width");
            android.graphics.Bitmap frame=metadata.getFrameAtTime();check(frame!=null,"Video contains a decodable frame");if(frame!=null)frame.recycle();metadata.release();
            result.putString("stream","PASS: "+checks+" video checks, consent UI, MP4 duration="+duration+"ms\nSession: "+dir.getName()+"\n");
            main(()->{service.hideControls();app.refresh();});finish(Activity.RESULT_OK,result);
        }catch(Throwable e){android.util.Log.e("MoTA-test","Video test failed",e);result.putString("stream","FAIL: "+e+"\nUI: "+labels+"\n");finish(Activity.RESULT_CANCELED,result);}
    }
    AccessibilityNodeInfo findText(AccessibilityNodeInfo n,String text){if(n==null)return null;if(n.getText()!=null&&text.contentEquals(n.getText()))return n;for(int i=0;i<n.getChildCount();i++){AccessibilityNodeInfo found=findText(n.getChild(i),text);if(found!=null)return found;}return null;}
    void click(AccessibilityNodeInfo node){for(int i=0;i<4&&node!=null;i++,node=node.getParent()){if(node.isClickable()){node.performAction(AccessibilityNodeInfo.ACTION_CLICK);return;}}}
    String labels(AccessibilityNodeInfo n){if(n==null)return "";StringBuilder out=new StringBuilder();if(n.getText()!=null)out.append(n.getText()).append(" | ");for(int i=0;i<n.getChildCount();i++)out.append(labels(n.getChild(i)));return out.toString();}
}
