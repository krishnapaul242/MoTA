package dev.mota.recorder;

import android.app.*;
import android.content.*;
import android.os.*;
import android.view.*;
import android.view.accessibility.AccessibilityNodeInfo;
import android.widget.*;
import org.json.*;
import java.io.*;
import java.util.zip.*;

/** On-emulator integration test: real input injection through the overlay, no root. */
public class SmokeTest extends Instrumentation {
    UiAutomation automation;
    RecorderService service;
    PracticeActivity activity;
    int checks;
    @Override public void onCreate(Bundle args){super.onCreate(args);start();}
    void check(boolean result,String label){if(!result)throw new AssertionError(label);checks++;}
    void main(Runnable action){runOnMainSync(action);}
    void waitFor(java.util.concurrent.Callable<Boolean> condition,long timeout) throws Exception {
        long until=SystemClock.elapsedRealtime()+timeout;
        while(SystemClock.elapsedRealtime()<until){if(condition.call())return;SystemClock.sleep(50);}
        throw new AssertionError("Timed out waiting for recorder state");
    }
    @Override public void onStart(){
        Bundle result=new Bundle();
        try {
            automation=getUiAutomation(UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES);
            // Instrumentation restarts the target process, which Android marks as a crashed
            // accessibility connection. Rebind after instrumentation owns the new process.
            String enabled=android.provider.Settings.Secure.getString(getTargetContext().getContentResolver(),"enabled_accessibility_services");
            shell("settings put secure enabled_accessibility_services null");SystemClock.sleep(1500);
            shell("settings put secure enabled_accessibility_services "+enabled);
            shell("settings put secure accessibility_enabled 1");
            waitFor(()->RecorderService.live!=null,45000);service=RecorderService.live;
            activity=(PracticeActivity)startActivitySync(new Intent(getTargetContext(),PracticeActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            waitForIdleSync();SystemClock.sleep(500);
            main(()->{service.showControls(null);service.startSession();service.panelParams.y=service.height()-service.dp(220);service.wm.updateViewLayout(service.panel,service.panelParams);});
            waitForIdleSync();SystemClock.sleep(500);
            final Button[] tap={null}; main(()->tap[0]=findButton(activity.getWindow().getDecorView()));
            check(tap[0]!=null,"Practice tap button exists");
            int[] location=new int[2];main(()->tap[0].getLocationOnScreen(location));
            float x=location[0]+100,y=location[1]+tap[0].getHeight()/2f;
            finger(x,y,100);waitFor(()->service.session.actions.length()==1&&!service.busy,20000);
            final String[] text={null};waitFor(()->{main(()->text[0]=tap[0].getText().toString());return "Taps: 1".equals(text[0]);},10000);check("Taps: 1".equals(text[0]),"Recorded tap reached underlying activity exactly once");
            waitFor(()->service.shotsPending==0&&service.session.data.getJSONArray("screenshots").length()>0,20000);
            float mid=service.height()*0.45f;
            swipe(100,mid,service.width()-120,mid+120);waitFor(()->service.session.actions.length()==2&&!service.busy,20000);
            waitForIdleSync();SystemClock.sleep(500);pinch(service.width()/2f,service.height()*0.58f);waitFor(()->service.session.actions.length()==3&&!service.busy,20000);
            waitFor(()->service.shotsPending==0,20000);SystemClock.sleep(300);
            finger(service.width()*0.7f,service.height()*0.5f,650);
            waitFor(()->service.session.actions.length()==4&&!service.busy,20000);
            waitFor(()->service.shotsPending==0,20000);
            JSONObject data=SessionStore.read(service.session.dir);JSONArray actions=data.getJSONArray("actions");
            check(actions.length()==4,"Four actions persisted");
            check(actions.getJSONObject(3).getJSONArray("strokes").getJSONObject(0).getLong("durationMs")>=600,"Long press duration preserved");
            check(actions.getJSONObject(2).getJSONArray("strokes").length()==2,"Two-finger gesture persisted");
            check("completed".equals(actions.getJSONObject(2).getString("dispatch")),"Multitouch dispatched successfully");
            check(data.getJSONArray("screenshots").length()>0,"Screenshot captured and indexed");
            File png=new File(service.session.dir,data.getJSONArray("screenshots").getJSONObject(0).getString("file"));
            try(FileInputStream in=new FileInputStream(png)){check(in.read()==137&&in.read()==80,"Screenshot is a real PNG");}
            main(()->service.togglePause());SystemClock.sleep(250);check(service.paused&&service.touch==null,"Pause removes touch capture");
            finger(x,y,100);SystemClock.sleep(250);main(()->text[0]=tap[0].getText().toString());check("Taps: 2".equals(text[0]),"Paused input reaches app");
            check(service.session.actions.length()==4,"Paused tap not recorded");
            main(()->{service.togglePause();service.stopEverything("Test saved");service.replaySelected();});
            waitFor(()->!service.playing,20000);
            main(()->text[0]=tap[0].getText().toString());check("Taps: 3".equals(text[0]),"Replay delivered recorded tap");
            check("Replay complete".equals(service.message),"Replay finished all four gestures");
            main(()->service.replaySelected());main(()->service.stopEverything("Test stop"));
            SystemClock.sleep(3500);main(()->text[0]=tap[0].getText().toString());check("Taps: 3".equals(text[0]),"Stop cancelled queued replay");
            ByteArrayOutputStream out=new ByteArrayOutputStream();SessionStore.export(service.selected,out);
            boolean json=false,image=false;try(ZipInputStream zip=new ZipInputStream(new ByteArrayInputStream(out.toByteArray()))){ZipEntry entry;while((entry=zip.getNextEntry())!=null){if(entry.getName().equals("actions.json"))json=true;if(entry.getName().endsWith(".png"))image=true;}}
            check(json&&image,"ZIP contains actions and screenshots");
            JSONObject bad=new JSONObject(data.toString()).put("width",data.getInt("width")+1);
            check(!service.sameDisplay(bad),"Display mismatch rejected");
            // Record explicit Unicode text through the real overlay dialog, then replay it.
            final EditText[] field={null};main(()->{field[0]=findEdit(activity.getWindow().getDecorView());field[0].requestFocus();service.startSession();});
            SystemClock.sleep(300);main(()->service.textDialog());SystemClock.sleep(500);
            AccessibilityNodeInfo root=automation.getRootInActiveWindow();
            AccessibilityNodeInfo input=findNode(root,"android.widget.EditText",null);
            check(input!=null,"Text control opened its insertion dialog");
            Bundle textArgs=new Bundle();textArgs.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,"MoTA ✓ नमस्ते");
            check(input.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT,textArgs),"Unicode text entered into helper dialog");
            AccessibilityNodeInfo insert=findNode(root,"android.widget.Button","Insert");check(insert!=null&&insert.performAction(AccessibilityNodeInfo.ACTION_CLICK),"Insert button accepted");
            waitFor(()->service.session.actions.length()==1,20000);
            main(()->{text[0]=field[0].getText().toString();service.stopEverything("Text saved");});
            check("MoTA ✓ नमस्ते".equals(text[0]),"Unicode text inserted into underlying app");
            main(()->{field[0].setText("");field[0].requestFocus();service.replaySelected();});waitFor(()->!service.playing,30000);
            main(()->text[0]=field[0].getText().toString());check("MoTA ✓ नमस्ते".equals(text[0]),"Unicode text replay succeeded");
            result.putString("stream","PASS: "+checks+" checks; tap, long press, swipe, multitouch, Unicode text, screenshot, pause, replay, cancel, ZIP, display guard\nSession: "+service.selected.getName()+"\n");
            main(()->service.hideControls());finish(Activity.RESULT_OK,result);
        }catch(Throwable e){android.util.Log.e("MoTA-test","Smoke test failed",e);result.putString("stream","FAIL: "+e+"\n");finish(Activity.RESULT_CANCELED,result);}
    }
    EditText findEdit(View v){if(v instanceof EditText)return (EditText)v;if(v instanceof ViewGroup){ViewGroup g=(ViewGroup)v;for(int i=0;i<g.getChildCount();i++){EditText e=findEdit(g.getChildAt(i));if(e!=null)return e;}}return null;}
    AccessibilityNodeInfo findNode(AccessibilityNodeInfo n,String cls,String text){if(n==null)return null;if(cls.contentEquals(n.getClassName())&&(text==null||text.contentEquals(n.getText()==null?"":n.getText())))return n;for(int i=0;i<n.getChildCount();i++){AccessibilityNodeInfo found=findNode(n.getChild(i),cls,text);if(found!=null)return found;}return null;}
    void shell(String command) throws Exception {
        try(android.os.ParcelFileDescriptor fd=automation.executeShellCommand(command);FileInputStream in=new FileInputStream(fd.getFileDescriptor())) {byte[] b=new byte[1024];while(in.read(b)!=-1) { }}
    }
    Button findButton(View view){if(view instanceof Button&&((Button)view).getText().toString().startsWith("Taps:"))return (Button)view;if(view instanceof android.view.ViewGroup){android.view.ViewGroup g=(android.view.ViewGroup)view;for(int i=0;i<g.getChildCount();i++){Button b=findButton(g.getChildAt(i));if(b!=null)return b;}}return null;}
    void send(MotionEvent e){check(automation.injectInputEvent(e,true),"Input injection accepted");e.recycle();}
    void finger(float x,float y,long hold){long down=SystemClock.uptimeMillis();send(MotionEvent.obtain(down,down,MotionEvent.ACTION_DOWN,x,y,0));SystemClock.sleep(hold);send(MotionEvent.obtain(down,SystemClock.uptimeMillis(),MotionEvent.ACTION_UP,x,y,0));}
    void swipe(float x,float y,float endX,float endY){long down=SystemClock.uptimeMillis();send(MotionEvent.obtain(down,down,0,x,y,0));for(int i=1;i<=8;i++){SystemClock.sleep(35);send(MotionEvent.obtain(down,SystemClock.uptimeMillis(),2,x+(endX-x)*i/8,y+(endY-y)*i/8,0));}send(MotionEvent.obtain(down,SystemClock.uptimeMillis(),1,endX,endY,0));}
    void multi(long down,int action,float cx,float cy,float spread,int count){
        MotionEvent.PointerProperties[] props=new MotionEvent.PointerProperties[count];MotionEvent.PointerCoords[] points=new MotionEvent.PointerCoords[count];
        for(int i=0;i<count;i++){props[i]=new MotionEvent.PointerProperties();props[i].id=i;props[i].toolType=MotionEvent.TOOL_TYPE_FINGER;points[i]=new MotionEvent.PointerCoords();points[i].x=cx+(i==0?-spread:spread);points[i].y=cy;points[i].pressure=1;points[i].size=1;}
        send(MotionEvent.obtain(down,SystemClock.uptimeMillis(),action,count,props,points,0,0,1,1,0,0,android.view.InputDevice.SOURCE_TOUCHSCREEN,0));
    }
    void pinch(float cx,float cy){long down=SystemClock.uptimeMillis();multi(down,0,cx,cy,35,1);SystemClock.sleep(20);multi(down,5|(1<<8),cx,cy,35,2);for(int i=1;i<=6;i++){SystemClock.sleep(40);multi(down,2,cx,cy,35+i*18,2);}multi(down,6|(1<<8),cx,cy,143,2);SystemClock.sleep(20);multi(down,1,cx,cy,143,1);}
}
