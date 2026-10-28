package dev.mota.recorder;

import android.app.*;
import android.content.*;
import android.graphics.Color;
import android.net.Uri;
import android.os.*;
import android.provider.Settings;
import android.view.*;
import android.widget.*;
import java.io.*;

public class MainActivity extends Activity {
    static MainActivity visible;
    boolean cancelledCapture;
    LinearLayout content,sessions;
    TextView serviceState,chosen;
    boolean remotePassive;String remoteOwner="";
    File selected,exporting;
    CheckBox video;
    static final int CAPTURE=10,EXPORT=11;
    int dp(int n){return Math.round(n*getResources().getDisplayMetrics().density);}
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);visible=this;
        getWindow().setDecorFitsSystemWindows(false);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR|View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        getWindow().setStatusBarColor(0xFF102A43);getWindow().setNavigationBarColor(0xFF102A43);
        ScrollView scroll=new ScrollView(this);scroll.setFillViewport(true);scroll.setBackgroundColor(0xFFF1F5F9);
        content=new LinearLayout(this);content.setOrientation(1);content.setPadding(dp(22),dp(22),dp(22),dp(28));scroll.addView(content);setContentView(scroll);
        scroll.setOnApplyWindowInsetsListener((v,insets)->{android.graphics.Insets bars=insets.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.displayCutout());content.setPadding(dp(22)+bars.left,dp(22)+bars.top,dp(22)+bars.right,dp(28)+bars.bottom);return insets;});
        label("MoTA Recorder",28,0xFF102A43);
        label("Record a flow. Run it again.",16,0xFF486581);
        serviceState=label("",14,0xFF147D64);
        label("1 · Enable accessibility",19,0xFF102A43);
        label("Enable MoTA Recorder in Android Accessibility settings. It reads the focused field for Text insertion, captures screenshots and sends the gestures you record. No root or ADB needed.",14,0xFF486581);
        button("Open accessibility settings",()->startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)));
        label("2 · Prepare your session",19,0xFF102A43);
        label("Open the target app, then use the floating Record button. Each gesture is delivered after you lift your finger. Drag the status label to move the controls. Use Back / Home / Recents in the toolbar to record navigation.",14,0xFF486581);
        video=new CheckBox(this);video.setText("Include screen video (no audio)");video.setTextColor(0xFF102A43);content.addView(video);
        button("New recording",()->newRecording());
        button("Show floating controls",()-> {RecorderService s=service();if(s!=null){s.showControls(selected);moveTaskToBack(true);}});
        button("Stop recording / replay",()-> {RecorderService s=service();if(s!=null)s.stopEverything("Stopped • session saved");refresh();});
        button("Practice pad",()->startActivity(new Intent(this,PracticeActivity.class)));
        label("3 · Saved sessions",19,0xFF102A43);
        chosen=label("",14,0xFF147D64);
        button("Replay selected · 3 second countdown",()-> {
            RecorderService s=service();if(s==null||selected==null)return;
            new AlertDialog.Builder(this).setTitle("Replay selected session?").setMessage("Prepare the same starting screen and app state. Replay performs the saved actions, including any submits. Display size and rotation must match. Stop in the floating toolbar cancels.")
                .setPositiveButton("Replay",(d,w)->{s.showControls(selected);moveTaskToBack(true);s.replaySelected();}).setNegativeButton("Cancel",null).show();
        });
        button("Export selected session as ZIP",()->exportSelected());
        sessions=new LinearLayout(this);sessions.setOrientation(1);content.addView(sessions);
        label("What this version records",19,0xFF102A43);
        label("Taps, holds, curved swipes and multitouch paths; toolbar navigation; volume presses when Android delivers them; text entered through Text; screenshots after gestures (at most once per second); optional MP4 video. Pause allows normal unrecorded interaction. Video keeps running while paused.",14,0xFF486581);
        label("Limitations",19,0xFF102A43);
        label("Overlay recording delays each gesture until finger-up. Replay preserves path shape and duration, but Android controls speed along the path. System edge gestures, power/fingerprint, arbitrary hardware keys and exact keyboard text capture are not supported. Keyboard taps may replay, but use Text for repeatable text entry. Protected screens may block capture. Video can include the floating controls. Sessions can contain screen content and entered text; use test data. Files stay private to this app until exported; uninstalling deletes them.",14,0xFF486581);
        if(Build.VERSION.SDK_INT>=33&&checkSelfPermission("android.permission.POST_NOTIFICATIONS")!=android.content.pm.PackageManager.PERMISSION_GRANTED)
            requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"},20);
        if(getIntent().getBooleanExtra("mota.remoteVideo",false))getWindow().getDecorView().post(()->remoteVideo(getIntent()));
    }
    @Override protected void onNewIntent(Intent intent){super.onNewIntent(intent);setIntent(intent);if(intent.getBooleanExtra("mota.remoteVideo",false))remoteVideo(intent);}
    @Override protected void onDestroy(){if(visible==this)visible=null;super.onDestroy();}
    void cancelRemoteVideo(){cancelledCapture=true;remotePassive=false;finishActivity(CAPTURE);}
    void remoteVideo(Intent intent){remoteOwner=intent.getStringExtra("mota.remoteOwner");remotePassive="adb".equals(intent.getStringExtra("mota.remoteMode"));video.setChecked(true);newRecording();}
    TextView label(String text,int size,int color){TextView t=new TextView(this);t.setText(text);t.setTextSize(size);t.setTextColor(color);t.setPadding(0,dp(8),0,dp(8));content.addView(t);return t;}
    void button(String text,Runnable run){Button b=new Button(this);b.setText(text);b.setAllCaps(false);content.addView(b,new LinearLayout.LayoutParams(-1,dp(52)));b.setOnClickListener(v->run.run());}
    RecorderService service(){RecorderService s=RecorderService.live;if(s==null)Toast.makeText(this,"Enable MoTA Recorder accessibility first",Toast.LENGTH_LONG).show();return s;}
    @Override protected void onResume(){super.onResume();refresh();}
    void refresh(){
        if(sessions==null)return;
        RecorderService s=RecorderService.live;serviceState.setText(s==null?"Accessibility is off":"Accessibility ready • "+s.message);
        File[] files=SessionStore.list(this);
        if(selected==null&&files.length>0)selected=files[0];
        chosen.setText(selected==null?"No sessions yet":"Selected: "+selected.getName());sessions.removeAllViews();
        for(File dir:files){
            Button b=new Button(this);b.setAllCaps(false);
            String detail="";try{org.json.JSONObject d=SessionStore.read(dir);detail=" · "+d.getJSONArray("actions").length()+" actions · "+d.optString("videoStatus");}catch(Exception e){detail=" · unavailable";}
            b.setText(dir.getName()+detail);sessions.addView(b);b.setOnClickListener(v->{selected=dir;refresh();});
        }
    }
    void newRecording(){
        RecorderService s=service();if(s==null)return;cancelledCapture=false;
        if(s.recording||s.playing||s.shotsPending>0||CaptureService.active){Toast.makeText(this,"Stop the current session and wait for capture to finish",Toast.LENGTH_LONG).show();return;}
        if(video.isChecked()) {
            android.media.projection.MediaProjectionManager manager=getSystemService(android.media.projection.MediaProjectionManager.class);
            startActivityForResult(manager.createScreenCaptureIntent(),CAPTURE);
        }else {s.showControls(null);s.startSession();moveTaskToBack(true);}
    }
    void exportSelected(){
        if(selected==null)return;
        RecorderService s=RecorderService.live;
        if((s!=null&&(s.recording||s.playing||s.shotsPending>0))||CaptureService.active){Toast.makeText(this,"Stop and wait for capture to finish before exporting",Toast.LENGTH_LONG).show();return;}
        exporting=selected;
        Intent i=new Intent(Intent.ACTION_CREATE_DOCUMENT).setType("application/zip").addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_TITLE,"mota-"+selected.getName()+".zip");startActivityForResult(i,EXPORT);
    }
    @Override protected void onActivityResult(int request,int result,Intent intent){
        super.onActivityResult(request,result,intent);
        if(request==CAPTURE&&result!=RESULT_OK)remotePassive=false;
        if(request==CAPTURE&&!cancelledCapture&&result==RESULT_OK&&intent!=null){RecorderService s=service();if(s!=null){s.showControls(null);s.startVideoSession(result,intent,remotePassive);if(s.recording&&s.session!=null&&remoteOwner!=null){try{s.session.set("captureOwner",remoteOwner);}catch(Exception e){s.error(e);}}remotePassive=false;remoteOwner="";moveTaskToBack(true);}}
        if(request==EXPORT&&result==RESULT_OK&&intent!=null&&exporting!=null){
            final File dir=exporting;final Uri uri=intent.getData();
            new Thread(()->{String msg;try{OutputStream out=getContentResolver().openOutputStream(uri);if(out==null)throw new IOException("Cannot open destination");SessionStore.export(dir,out);msg="Session ZIP exported";}catch(Exception e){msg="Export failed: "+e.getMessage();}
                final String text=msg;runOnUiThread(()->Toast.makeText(this,text,Toast.LENGTH_LONG).show());},"mota-export").start();
        }
    }
}
