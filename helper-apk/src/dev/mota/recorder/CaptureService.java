package dev.mota.recorder;

import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.hardware.display.*;
import android.media.*;
import android.media.projection.*;
import android.os.*;
import org.json.*;
import java.io.*;

/** User-approved video only; no microphone, network, or storage permissions. */
public class CaptureService extends Service {
    static volatile boolean active;
    MediaProjection projection;
    VirtualDisplay display;
    MediaRecorder recorder;
    SessionStore session;
    boolean started,closing;
    @Override public IBinder onBind(Intent i){return null;}
    @Override public void onCreate(){super.onCreate();active=true;}
    @Override public int onStartCommand(Intent intent,int flags,int id) {
        if(intent==null||recorder!=null){stopSelf();return START_NOT_STICKY;}
        try {
            NotificationManager nm=getSystemService(NotificationManager.class);
            nm.createNotificationChannel(new NotificationChannel("capture","Screen recording",NotificationManager.IMPORTANCE_LOW));
            PendingIntent open=PendingIntent.getActivity(this,0,new Intent(this,MainActivity.class),PendingIntent.FLAG_IMMUTABLE);
            startForeground(7,new Notification.Builder(this,"capture").setSmallIcon(dev.mota.recorder.R.drawable.icon)
                .setContentTitle("MoTA is recording the screen").setContentText("Use Stop in the floating controls or open MoTA to stop")
                .setContentIntent(open).setOngoing(true).build(),ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
            RecorderService s=RecorderService.live;
            if(s==null||!s.recording||s.session==null||!s.session.dir.getAbsolutePath().equals(intent.getStringExtra("dir"))) {
                stopSelf();return START_NOT_STICKY;
            }
            session=s.session;
            int w=s.width(),h=s.height();float scale=Math.min(1f,1920f/Math.max(w,h));
            w=Math.max(2,((int)(w*scale)/2)*2);h=Math.max(2,((int)(h*scale)/2)*2);
            recorder=new MediaRecorder();recorder.setVideoSource(MediaRecorder.VideoSource.SURFACE);
            recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
            recorder.setOutputFile(new File(session.dir,"screen.mp4").getAbsolutePath());
            recorder.setVideoEncoder(MediaRecorder.VideoEncoder.H264);recorder.setVideoSize(w,h);
            recorder.setVideoFrameRate(30);recorder.setVideoEncodingBitRate(4000000);recorder.prepare();
            MediaProjectionManager manager=getSystemService(MediaProjectionManager.class);
            projection=manager.getMediaProjection(intent.getIntExtra("result",Activity.RESULT_CANCELED),(Intent)intent.getParcelableExtra("consent"));
            if(projection==null)throw new IOException("Screen capture permission unavailable");
            projection.registerCallback(new MediaProjection.Callback(){
                @Override public void onStop(){stopSelf();}
            },new Handler(Looper.getMainLooper()));
            display=projection.createVirtualDisplay("MoTA recording",w,h,getResources().getDisplayMetrics().densityDpi,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,recorder.getSurface(),null,null);
            recorder.start();started=true;
            session.set("videoStartWallMs",SystemClock.elapsedRealtime()-session.origin);
            session.set("videoWidth",w);session.set("videoHeight",h);session.set("videoStatus","recording");
            s.say("Recording gestures + video");s.updateButtons();
        }catch(Exception e){if(session!=null)session.note("Video failed: "+e.getMessage());if(RecorderService.live!=null)RecorderService.live.toast("Video failed: "+e.getMessage());stopSelf();}
        return START_NOT_STICKY;
    }
    @Override public void onDestroy() {
        if(closing)return;closing=true;
        String result="failed";
        if(recorder!=null){try{if(started){recorder.stop();result="saved";}}catch(Exception e){if(session!=null)session.note("Video finalization failed: "+e.getMessage());}recorder.release();}
        if(display!=null)display.release();if(projection!=null)projection.stop();
        if(session!=null){try{session.set("videoStatus",result);session.set("videoEndWallMs",SystemClock.elapsedRealtime()-session.origin);}catch(Exception e){session.note("Video metadata failed: "+e.getMessage());}}
        active=false;stopForeground(STOP_FOREGROUND_REMOVE);
        RecorderService s=RecorderService.live;
        if(s!=null){s.updateButtons();if(s.recording)s.say("Video stopped • gesture recording continues");}
        super.onDestroy();
    }
}
