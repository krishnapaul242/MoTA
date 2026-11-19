package dev.mota.recorder;

import android.accessibilityservice.*;
import android.app.*;
import android.content.*;
import android.content.res.Configuration;
import android.graphics.*;
import android.media.AudioManager;
import android.os.*;
import android.view.*;
import android.view.accessibility.*;
import android.widget.*;
import org.json.*;
import java.io.*;
import java.util.concurrent.*;

public class RecorderService extends AccessibilityService {
    static volatile RecorderService live;
    final Handler main=new Handler(Looper.getMainLooper());
    final ExecutorService io=Executors.newSingleThreadExecutor();
    WindowManager wm;
    LinearLayout panel,compactControls,expandedControls;
    ImageButton compactRecordButton,expandButton,collapseButton;
    boolean overlayExpanded;
    TextView status;
    Button pauseButton,recordButton,playButton;
    TouchLayer touch;
    WindowManager.LayoutParams panelParams;
    volatile SessionStore session;
    File selected;
    volatile boolean recording,paused,busy,playing,passiveRecording;
    int replayIndex,replayTotal;
    int replayToken;volatile int shotsPending;
    long lastDone,gestureAt,lastScreenshot;
    int screenshotNumber;
    String message="Ready";

    @Override public void onServiceConnected() { live=this; wm=getSystemService(WindowManager.class);try{Bridge.ensure(this);}catch(Exception e){error(e);} }
    @Override public void onAccessibilityEvent(AccessibilityEvent event) { }
    @Override public void onInterrupt() { stopEverything("Accessibility interrupted"); }
    @Override public void onDestroy() {
        stopEverything("Service stopped"); hideControls(); live=null; io.shutdown(); super.onDestroy();
    }
    @Override public void onConfigurationChanged(Configuration c) {
        super.onConfigurationChanged(c);
        if(recording || playing) stopEverything("Display changed. Start a new session in this orientation.");
    }
    int width() { return Compat.displaySize(wm).x; }
    int height() { return Compat.displaySize(wm).y; }
    int rotation() { return getSystemService(android.hardware.display.DisplayManager.class).getDisplay(android.view.Display.DEFAULT_DISPLAY).getRotation(); }
    int dp(int n) { return Math.round(n*getResources().getDisplayMetrics().density); }
    void say(String s) { message=s; if(status!=null) status.setText(s); }
    void toast(String s) { Toast.makeText(this,s,Toast.LENGTH_LONG).show(); say(s); }

    void showControls(File file) {
        if(file!=null && !recording && !playing) selected=file;
        if(panel!=null) { say(message); return; }
        overlayExpanded=getSharedPreferences("overlay",0).getBoolean("expanded",false);
        panel=new LinearLayout(this); panel.setOrientation(LinearLayout.VERTICAL);
        panel.setPadding(dp(6),dp(4),dp(6),dp(4));
        android.graphics.drawable.GradientDrawable background=new android.graphics.drawable.GradientDrawable();
        background.setColor(0xF5102A43);background.setCornerRadius(dp(12));panel.setBackground(background);
        compactControls=new LinearLayout(this);panel.addView(compactControls);
        compactRecordButton=icon(compactControls,R.drawable.record,"Start recording",()->{
            if(recording||playing||CaptureService.active)stopEverything("Stopped • session saved");else startSession();
        });
        expandButton=icon(compactControls,R.drawable.chevron_expand,"Expand recorder controls",()->setOverlayExpanded(true));
        expandedControls=new LinearLayout(this);expandedControls.setOrientation(LinearLayout.VERTICAL);panel.addView(expandedControls);
        LinearLayout header=new LinearLayout(this);expandedControls.addView(header);
        status=new TextView(this);status.setTextColor(0xFF72EFCE);status.setTextSize(11);status.setMaxLines(2);
        status.setGravity(Gravity.CENTER_VERTICAL);status.setPadding(dp(4),0,dp(4),0);
        status.setContentDescription("Recorder status. Drag to move controls.");
        header.addView(status,new LinearLayout.LayoutParams(0,dp(48),1));installDrag(status,true);
        collapseButton=icon(header,R.drawable.chevron_collapse,"Collapse recorder controls",()->setOverlayExpanded(false));
        LinearLayout r=row(); recordButton=button(r,"Record",()->startSession());
        pauseButton=button(r,"Pause",()->togglePause()); button(r,"Stop",()->stopEverything("Stopped • session saved"));
        playButton=button(r,"Play",()->replaySelected());
        r=row(); button(r,"Back",()->global(GLOBAL_ACTION_BACK)); button(r,"Home",()->global(GLOBAL_ACTION_HOME));
        button(r,"Shot",()->screenshot(-1,true)); button(r,"Text",()->textDialog());
        r=row(); button(r,"Recents",()->global(GLOBAL_ACTION_RECENTS)); button(r,"Open",()->openApp());
        button(r,"Hide",()-> {stopEverything("Controls closed");hideControls();});
        panelParams=new WindowManager.LayoutParams(dp(overlayExpanded?290:108),WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,PixelFormat.TRANSLUCENT);
        panelParams.gravity=Gravity.TOP|Gravity.LEFT; panelParams.x=dp(12);panelParams.y=dp(40);
        compactControls.setVisibility(overlayExpanded?View.GONE:View.VISIBLE);
        expandedControls.setVisibility(overlayExpanded?View.VISIBLE:View.GONE);
        wm.addView(panel,panelParams); say(message); updateButtons();panel.post(this::clampOverlay);
    }
    ImageButton icon(LinearLayout row,int drawable,String description,Runnable action){
        ImageButton button=new ImageButton(this);button.setImageResource(drawable);button.setContentDescription(description);
        button.setScaleType(ImageView.ScaleType.CENTER);button.setPadding(dp(12),dp(12),dp(12),dp(12));
        android.util.TypedValue value=new android.util.TypedValue();getTheme().resolveAttribute(android.R.attr.selectableItemBackgroundBorderless,value,true);
        button.setBackgroundResource(value.resourceId);row.addView(button,new LinearLayout.LayoutParams(dp(48),dp(48)));
        button.setOnClickListener(v->action.run());return button;
    }
    void setOverlayExpanded(boolean expanded){
        overlayExpanded=expanded;getSharedPreferences("overlay",0).edit().putBoolean("expanded",expanded).apply();
        if(panel==null)return;
        compactControls.setVisibility(expanded?View.GONE:View.VISIBLE);expandedControls.setVisibility(expanded?View.VISIBLE:View.GONE);
        panelParams.width=dp(expanded?290:108);clampOverlay();panel.requestLayout();panel.post(this::clampOverlay);
    }
    void clampOverlay(){
        if(panel==null||!panel.isAttachedToWindow())return;
        panelParams.x=Math.max(0,Math.min(Math.max(0,width()-panelParams.width),panelParams.x));
        panelParams.y=Math.max(0,Math.min(Math.max(0,height()-panel.getHeight()-dp(48)),panelParams.y));
        wm.updateViewLayout(panel,panelParams);
    }
    void installDrag(View view,boolean handleOnly){
        view.setOnTouchListener(new View.OnTouchListener(){
            float downX,downY;int initialX,initialY;boolean dragging;
            public boolean onTouch(View v,MotionEvent e){
                switch(e.getActionMasked()){
                    case MotionEvent.ACTION_DOWN:downX=e.getRawX();downY=e.getRawY();initialX=panelParams.x;initialY=panelParams.y;dragging=false;v.setPressed(!handleOnly);return true;
                    case MotionEvent.ACTION_MOVE:
                        float dx=e.getRawX()-downX,dy=e.getRawY()-downY;
                        if(!dragging&&Math.hypot(dx,dy)>ViewConfiguration.get(RecorderService.this).getScaledTouchSlop()){dragging=true;v.setPressed(false);}
                        if(dragging){panelParams.x=initialX+Math.round(dx);panelParams.y=initialY+Math.round(dy);clampOverlay();}
                        return true;
                    case MotionEvent.ACTION_UP:boolean click=!handleOnly&&!dragging;dragging=false;v.setPressed(false);if(click)v.performClick();return true;
                    case MotionEvent.ACTION_CANCEL:dragging=false;v.setPressed(false);return true;
                    default:return handleOnly||dragging;
                }
            }
        });
    }
    LinearLayout row() { LinearLayout r=new LinearLayout(this);expandedControls.addView(r);return r; }
    Button button(LinearLayout r,String name,Runnable action) {
        Button b=new Button(this);b.setText(name);b.setTextSize(11);b.setAllCaps(false);b.setMinWidth(0);b.setMinimumWidth(0);
        b.setMinHeight(0);b.setMinimumHeight(0); b.setPadding(0,0,0,0);
        r.addView(b,new LinearLayout.LayoutParams(0,dp(34),1)); b.setOnClickListener(v->action.run());return b;
    }
    void updateButtons() {
        if(panel==null)return;
        boolean active=recording||playing||CaptureService.active;
        compactRecordButton.setImageResource(active?R.drawable.stop:R.drawable.record);
        compactRecordButton.setContentDescription(active?(playing?"Stop replay":"Stop recording"):"Start recording");
        compactRecordButton.setEnabled(active||(!busy&&shotsPending==0));
        recordButton.setEnabled(!recording&&!playing&&!busy&&shotsPending==0&&!CaptureService.active);
        playButton.setEnabled(!recording&&!playing&&!busy&&shotsPending==0&&!CaptureService.active&&selected!=null);
        pauseButton.setEnabled(recording&&!busy&&!passiveRecording);pauseButton.setText(paused?"Resume":"Pause");
    }
    void panelPassThrough(boolean enabled) {
        if(panel==null)return;
        if(enabled)panelParams.flags|=WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE;
        else panelParams.flags&=~WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE;
        wm.updateViewLayout(panel,panelParams);
    }
    void hideControls() { removeTouch(); if(panel!=null){ wm.removeView(panel);panel=null;status=null;compactControls=null;expandedControls=null;compactRecordButton=null;expandButton=null;collapseButton=null; } }
    void openApp() {
        if(recording&&!paused) togglePause();
        startActivity(new Intent(this,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
    }
    void startSession(){startSession(false);}
    void startSession(boolean passive) {
        if(recording||playing||busy||shotsPending>0||CaptureService.active)return;
        try {
            session=new SessionStore(this,width(),height(),rotation()); selected=session.dir;
            recording=true;passiveRecording=passive;session.set("captureMode",passive?"adb-events":"overlay-then-dispatch");paused=false;lastDone=0;screenshotNumber=0;
            if(passive)hideControls();else showControls(null); showTouch();updateButtons();say("Recording • drag this label to move controls");
        } catch(Exception e) { error(e); }
    }
    // Called before the MediaProjection foreground service starts.
    void startVideoSession(int result,Intent consent){startVideoSession(result,consent,false);}
    void startVideoSession(int result,Intent consent,boolean passive) {
        startSession(passive); if(!recording)return;
        try { session.set("videoStatus","starting"); }
        catch(Exception e) { error(e);return; }
        Intent i=new Intent(this,CaptureService.class).putExtra("result",result).putExtra("consent",consent).putExtra("dir",session.dir.getAbsolutePath());
        startForegroundService(i);
    }
    void togglePause() {
        if(!recording||busy||passiveRecording)return;
        paused=!paused;
        if(paused) {session.pause();removeTouch();say("Paused • interaction is not recorded");}
        else {session.resume();showTouch();say("Recording");}
        updateButtons();
    }
    void stopEverything(String reason) {
        boolean wasRecording=recording;
        recording=false;paused=false;playing=false;replayToken++;removeTouch();panelPassThrough(false);
        if(wasRecording&&session!=null) {
            try{session.set("durationMs",session.now());session.set("finished",true);}catch(Exception e){error(e);}
        }
        if(wasRecording||CaptureService.active) stopService(new Intent(this,CaptureService.class));
        say(reason);updateButtons();
    }
    void error(Exception e) { android.util.Log.e("MoTA", "Recorder error",e);toast(e.getMessage()==null?e.toString():e.getMessage()); }
    void showTouch() {
        if(touch!=null||!recording||paused||busy||passiveRecording)return;
        touch=new TouchLayer();
        WindowManager.LayoutParams p=new WindowManager.LayoutParams(-1,-1,WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE|WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN|WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,PixelFormat.TRANSLUCENT);
        p.gravity=Gravity.TOP|Gravity.LEFT;Compat.coverWholeScreen(p);
        wm.addView(touch,p);
        // The panel must stay above the touch layer, including after every dispatch.
        if(panel!=null) {wm.removeView(panel);wm.addView(panel,panelParams);}
    }
    void removeTouch() { if(touch!=null) {wm.removeViewImmediate(touch);touch=null;} }
    class TouchLayer extends View {
        boolean tracking;
        GestureCodec codec=new GestureCodec(); Paint paint=new Paint(3); Path trace=new Path();
        TouchLayer(){super(RecorderService.this);setBackgroundColor(Color.TRANSPARENT);paint.setColor(0xBB31D8B0);paint.setStyle(Paint.Style.STROKE);paint.setStrokeWidth(dp(3));}
        @Override protected void onDraw(Canvas c){c.drawPath(trace,paint);}
        @Override public boolean onTouchEvent(MotionEvent e) {
            if(!recording||paused||busy)return true;
            try {
                if(e.getActionMasked()==MotionEvent.ACTION_DOWN) {tracking=true;codec.begin(e);gestureAt=session.now();trace.reset();trace.moveTo(e.getX(),e.getY());}
                codec.accept(e);trace.lineTo(e.getX(),e.getY());invalidate();
                if(e.getActionMasked()==MotionEvent.ACTION_CANCEL) {tracking=false;trace.reset();say("Gesture cancelled; retry");}
                if(e.getActionMasked()==MotionEvent.ACTION_UP) {
                    tracking=false;
                    if(codec.overflow){toast("Gesture too long or too many samples/pointers; not sent");return true;}
                    JSONObject a=codec.finish(gestureAt,width(),height(),rotation()).put("delayMs",Math.max(0,gestureAt-lastDone));
                    int index=session.add(a);busy=true;removeTouch();updateButtons();
                    main.postDelayed(()->sendRecorded(a,index),150);
                }
            } catch(Exception ex){error(ex);}
            return true;
        }
    }
    boolean sameDisplay(JSONObject a) throws Exception {
        return a.getInt("width")==width()&&a.getInt("height")==height()&&a.getInt("rotation")==rotation();
    }
    void sendRecorded(JSONObject a,int index) {
        if(!recording) {busy=false;updateButtons();return;}
        try {
            if(!sameDisplay(a))throw new IllegalArgumentException("Display changed");
            boolean accepted=dispatchGesture(GestureCodec.build(a,width(),height()),new GestureResultCallback(){
                @Override public void onCompleted(GestureDescription g){ recordedDone(a,index,true); }
                @Override public void onCancelled(GestureDescription g){ recordedDone(a,index,false); }
            },main);
            if(!accepted)recordedDone(a,index,false);
        }catch(Exception ex){busy=false;stopEverything("Gesture dispatch failed");error(ex);}
    }
    void recordedDone(JSONObject a,int index,boolean ok) {
        if(session!=null) {
            try{a.put("dispatch",ok?"completed":"cancelled");a.put("completedAtMs",session.now());session.save();}catch(Exception e){error(e);}
        }
        // Gesture completion can precede the target app handling its final UP.
        // Let that input transaction settle before reinstalling the capturing window.
        main.postDelayed(()-> {
            busy=false;
            if(!recording){updateButtons();return;}
            lastDone=session.now();
            if(!ok){stopEverything("Gesture cancelled • session saved");return;}
            say("Recording • "+session.actions.length()+" actions");showTouch();updateButtons();
            main.postDelayed(()-> {if(recording&&!paused&&!busy)screenshot(index,false);},220);
        },180);
    }

    void global(int action) {
        if(playing||busy)return;
        try {
            JSONObject a=new JSONObject().put("type","global").put("action",action);
            if(recording&&!paused){a.put("atMs",session.now()).put("delayMs",Math.max(0,session.now()-lastDone));session.add(a);}
            removeTouch();boolean ok=performGlobalAction(action);
            if(recording&&!paused){lastDone=session.now();if(!ok)session.note("Global action failed: "+action);main.postDelayed(this::showTouch,350);}
        }catch(Exception e){error(e);}
    }
    @Override protected boolean onKeyEvent(KeyEvent event) {
        int key=event.getKeyCode();
        if(recording&&!paused&&!busy&&!passiveRecording&&event.getAction()==KeyEvent.ACTION_DOWN&&event.getRepeatCount()==0
            &&(key==KeyEvent.KEYCODE_VOLUME_UP||key==KeyEvent.KEYCODE_VOLUME_DOWN)) {
            try{long at=session.now();session.add(new JSONObject().put("type","volume").put("keyCode",key).put("atMs",at).put("delayMs",Math.max(0,at-lastDone)));lastDone=at;}catch(Exception e){error(e);}
        }
        return false; // Let the system handle the original volume key.
    }
    void textDialog() {
        if(playing||busy)return;
        AccessibilityNodeInfo root=getRootInActiveWindow();
        AccessibilityNodeInfo focused=root==null?null:root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT);
        if(focused==null||!focused.isEditable()||focused.isPassword()){toast("Focus a non-password text field first");return;}
        removeTouch();
        EditText input=new EditText(this);input.setSingleLine(false);input.setHint("Replaces the focused field's text");
        AlertDialog d=new AlertDialog.Builder(this).setTitle("Insert and record text").setMessage("Text is stored in the exported session. Use test data.").setView(input)
            .setPositiveButton("Insert",(dialog,which)-> {
                try {
                    String value=input.getText().toString();Bundle b=new Bundle();b.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,value);
                    if(!focused.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT,b))throw new IOException("App rejected text insertion");
                    if(recording&&!paused) {long at=session.now();session.add(new JSONObject().put("type","text").put("text",value).put("atMs",at).put("delayMs",Math.max(0,at-lastDone)));lastDone=at;}
                }catch(Exception e){error(e);}
            }).setNegativeButton("Cancel",null).create();
        d.getWindow().setType(WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY);
        d.setOnDismissListener(x->{focused.recycle();main.postDelayed(this::showTouch,300);});d.show();
    }
    /**
     * Live control from the desktop, used where `adb shell input` is blocked (Xiaomi without the USB security setting).
     * Not recorded. Main thread only.
     */
    void liveInput(JSONObject p) throws Exception {
        if(playing||(recording&&!passiveRecording))throw new IOException("Stop the recording or replay on the device first");
        String type=p.getString("type");
        switch(type){
            case "tap": case "swipe":{
                int w=width(),h=height();
                Path path=new Path();path.moveTo(coord(p,"x",w),coord(p,"y",h));long ms=60;
                if(type.equals("swipe")){path.lineTo(coord(p,"x2",w),coord(p,"y2",h));ms=Math.max(50,Math.min(5000,p.optLong("duration",300)));}
                GestureDescription g=new GestureDescription.Builder().addStroke(new GestureDescription.StrokeDescription(path,0,ms)).build();
                if(!dispatchGesture(g,null,null))throw new IOException("Android rejected the gesture");
                break;
            }
            case "key":{
                String key=p.getString("key");int global=key.equals("back")?GLOBAL_ACTION_BACK:key.equals("home")?GLOBAL_ACTION_HOME:key.equals("recents")?GLOBAL_ACTION_RECENTS:key.equals("sleep")?GLOBAL_ACTION_LOCK_SCREEN:-1;
                if(global>=0){if(!performGlobalAction(global))throw new IOException("Android refused "+key);}
                else if(key.equals("volumeUp")||key.equals("volumeDown"))getSystemService(AudioManager.class).adjustSuggestedStreamVolume(key.equals("volumeUp")?AudioManager.ADJUST_RAISE:AudioManager.ADJUST_LOWER,AudioManager.USE_DEFAULT_STREAM_TYPE,AudioManager.FLAG_SHOW_UI);
                else if(key.equals("wake")){
                    // Accessibility cannot wake the screen; a short wake lock that turns it on can.
                    @SuppressWarnings("deprecation") PowerManager.WakeLock lock=getSystemService(PowerManager.class).newWakeLock(PowerManager.SCREEN_BRIGHT_WAKE_LOCK|PowerManager.ACQUIRE_CAUSES_WAKEUP,"mota:wake");
                    lock.acquire(3000);
                }
                else throw new IOException("Unsupported key: "+key);
                break;
            }
            case "text":{
                String text=p.getString("text");if(text.isEmpty()||text.length()>4096)throw new IOException("Enter up to 4096 characters");
                AccessibilityNodeInfo root=getRootInActiveWindow();AccessibilityNodeInfo node=root==null?null:root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT);
                if(node==null||!node.isEditable())throw new IOException("Tap a text field on the device first");
                // ACTION_SET_TEXT replaces the field, so append to what is already typed (not to the hint).
                CharSequence current=node.getText();boolean hint=node.isShowingHintText();
                Bundle b=new Bundle();b.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,(current==null||hint?"":current.toString())+text);
                boolean ok=node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT,b);node.recycle();
                if(!ok)throw new IOException("The app rejected text input");
                break;
            }
            default:throw new IOException("Unknown input type");
        }
    }
    static float coord(JSONObject p,String key,int size)throws Exception{double v=p.getDouble(key);if(!(v>=0&&v<size))throw new IOException("Coordinates are outside the screen");return (float)v;}
    void screenshot(int index,boolean manual) {
        final SessionStore target=session;
        if(target==null){toast("Record a session first");return;}
        if(busy||playing||(touch!=null&&touch.tracking)||shotsPending>0||SystemClock.elapsedRealtime()-lastScreenshot<1000){if(manual)toast("Wait a moment, then try Shot again");return;}
        lastScreenshot=SystemClock.elapsedRealtime(); final long at=target.now();
        String filename=String.format(java.util.Locale.US,"screenshots/%04d.png",++screenshotNumber);
        shotsPending++;
        // Overlays remain visible in video; hide panel briefly for still screenshots.
        if(panel!=null)panel.setAlpha(0f);
        Compat.FrameCallback save=(bitmap,error)->{
            Runnable write=()->{
                boolean saved=false;String problem=error;
                try {
                    if(bitmap!=null){
                        File f=new File(target.dir,filename); f.getParentFile().mkdirs();
                        try(OutputStream out=new FileOutputStream(f)){if(!bitmap.compress(Bitmap.CompressFormat.PNG,100,out))throw new IOException("PNG encoding failed");}
                        target.screenshot(filename,at,index);saved=true;
                    }
                }catch(Exception e){problem="Screenshot failed: "+e.getMessage();}
                finally {if(bitmap!=null)bitmap.recycle();}
                if(!saved)target.note(problem==null?"Screenshot failed":problem);
                final String message=saved?"Screenshot saved":"Screenshot failed; see session notes";main.post(()->shotDone(manual,message));
            };
            try{io.execute(write);}catch(java.util.concurrent.RejectedExecutionException e){if(bitmap!=null)bitmap.recycle();main.post(()->shotDone(manual,"Screenshot failed"));}
        };
        main.postDelayed(()-> {
            try {
                if(Compat.API30)Compat.Api30.screenshot(this,io,save);
                // Android 10 has no accessibility screenshots: grab a frame from the session's screen video instead.
                else if(CaptureService.live!=null)CaptureService.live.grabFrame(save);
                else save.done(null,"Screenshots on Android 10 need screen video for this session");
            }catch(Exception e){save.done(null,"Screenshot failed: "+e.getMessage());}
        },80);
    }
    void shotDone(boolean manual,String result) {shotsPending--;if(panel!=null)panel.setAlpha(1f);updateButtons();if(manual)toast(result);}

    void replaySelected() {
        if(recording||playing||busy||selected==null||shotsPending>0||CaptureService.active)return;
        try {
            JSONObject data=SessionStore.read(selected);
            if(data.optInt("schemaVersion")!=1)throw new IOException("Unsupported session schema");
            if(!sameDisplay(data))throw new IOException("Restore the recorded display size and rotation before replay");
            JSONArray actions=data.getJSONArray("actions");if(actions.length()==0)throw new IOException("Session has no actions");
            for(int i=0;i<actions.length();i++){JSONObject a=actions.getJSONObject(i);if("gesture".equals(a.optString("type"))&&!"completed".equals(a.optString("dispatch")))throw new IOException("Session contains an incomplete gesture; record it again");}
            replayIndex=0;replayTotal=actions.length();playing=true;removeTouch();updateButtons();int token=++replayToken;
            say("Replay in 3 seconds • Stop cancels");
            main.postDelayed(()->replayStep(actions,0,token),3000);
        }catch(Exception e){error(e);}
    }
    void replayStep(JSONArray actions,int index,int token) {
        if(!playing||token!=replayToken)return;
        replayIndex=index;
        if(index>=actions.length()){playing=false;say("Replay complete");updateButtons();return;}
        try {
            JSONObject a=actions.getJSONObject(index);
            long delay=a.optLong("delayMs",0);if(delay<0||delay>86400000)throw new IOException("Invalid action delay");
            say("Replay "+(index+1)+" / "+actions.length()+" • Stop cancels");
            main.postDelayed(()->executeReplay(actions,a,index,token),delay);
        }catch(Exception e){busy=false;stopEverything("Replay stopped");error(e);}
    }
    void executeReplay(JSONArray actions,JSONObject a,int index,int token) {
        if(!playing||token!=replayToken)return;
        Runnable next=()->replayStep(actions,index+1,token);
        try {
            switch(a.getString("type")) {
                case "gesture":
                    if(!sameDisplay(a))throw new IOException("Display changed");
                    busy=true;panelPassThrough(true);
                    if(!dispatchGesture(GestureCodec.build(a,width(),height()),new GestureResultCallback(){
                        @Override public void onCompleted(GestureDescription g){main.postDelayed(()->{busy=false;panelPassThrough(false);updateButtons();next.run();},100);}
                        @Override public void onCancelled(GestureDescription g){busy=false;panelPassThrough(false);if(token==replayToken)stopEverything("Replay gesture cancelled");updateButtons();}
                    },main))throw new IOException("Gesture rejected");
                    break;
                case "global": if(!performGlobalAction(a.getInt("action")))throw new IOException("Global action unavailable"); next.run();break;
                case "volume":getSystemService(AudioManager.class).adjustSuggestedStreamVolume(a.getInt("keyCode")==KeyEvent.KEYCODE_VOLUME_UP?AudioManager.ADJUST_RAISE:AudioManager.ADJUST_LOWER,AudioManager.USE_DEFAULT_STREAM_TYPE,0);next.run();break;
                case "text":
                    AccessibilityNodeInfo root=getRootInActiveWindow();AccessibilityNodeInfo node=root==null?null:root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT);
                    if(node==null||!node.isEditable()||node.isPassword())throw new IOException("Replay needs a focused non-password text field");
                    Bundle b=new Bundle();b.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,a.getString("text"));
                    boolean ok=node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT,b);node.recycle();if(!ok)throw new IOException("Text insertion failed");next.run();break;
                default:throw new IOException("Unknown action type");
            }
        }catch(Exception e){busy=false;stopEverything("Replay stopped");error(e);}
    }
}
