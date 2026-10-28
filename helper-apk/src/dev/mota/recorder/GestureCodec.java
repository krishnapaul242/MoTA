package dev.mota.recorder;

import android.accessibilityservice.GestureDescription;
import android.graphics.Path;
import android.view.MotionEvent;
import org.json.*;
import java.util.*;

/** A stroke per pointer, with pointer-relative start times and original sampled times. */
final class GestureCodec {
    static final long MAX_MS = GestureDescription.getMaxGestureDuration();
    final JSONArray strokes = new JSONArray();
    final Map<Integer, JSONObject> active = new HashMap<>();
    long down;
    int samples;
    boolean overflow;
    void begin(MotionEvent e) { strokesClear(); down=e.getEventTime(); samples=0; overflow=false; }
    private void strokesClear() { while(strokes.length()>0) strokes.remove(0); active.clear(); }
    void accept(MotionEvent e) throws JSONException {
        int action=e.getActionMasked(), index=e.getActionIndex();
        if(action==MotionEvent.ACTION_DOWN || action==MotionEvent.ACTION_POINTER_DOWN) {
            JSONObject s=new JSONObject().put("pointerId",e.getPointerId(index))
                .put("startMs", e.getEventTime()-down).put("points",new JSONArray());
            active.put(e.getPointerId(index),s); strokes.put(s);
        }
        if(e.getEventTime()-down >= MAX_MS-100 || strokes.length()>GestureDescription.getMaxStrokeCount() || samples>20000) overflow=true;
        if(overflow) return;
        // Historical samples retain curved paths and movement timing in the exported trace.
        for(int h=0;h<e.getHistorySize();h++) for(int p=0;p<e.getPointerCount();p++) {
            float offsetX=e.getRawX(p)-e.getX(p), offsetY=e.getRawY(p)-e.getY(p);
            point(e.getPointerId(p),e.getHistoricalX(p,h)+offsetX,e.getHistoricalY(p,h)+offsetY,e.getHistoricalEventTime(h)-down);
        }
        for(int p=0;p<e.getPointerCount();p++) point(e.getPointerId(p),e.getRawX(p),e.getRawY(p),e.getEventTime()-down);
        if(action==MotionEvent.ACTION_UP || action==MotionEvent.ACTION_POINTER_UP) active.remove(e.getPointerId(index));
    }
    private void point(int id,float x,float y,long t) throws JSONException {
        JSONObject s=active.get(id); if(s==null) return;
        JSONArray points=s.getJSONArray("points");
        points.put(new JSONArray().put(x).put(y).put(t)); samples++;
        s.put("durationMs",Math.max(1,t-s.getLong("startMs")));
    }
    JSONObject finish(long at,int w,int h,int rotation) throws JSONException {
        return new JSONObject().put("type","gesture").put("atMs",at).put("width",w).put("height",h)
            .put("rotation",rotation).put("strokes",new JSONArray(strokes.toString()));
    }
    static GestureDescription build(JSONObject a,int width,int height) throws Exception {
        if(a.getInt("width")!=width || a.getInt("height")!=height) throw new IllegalArgumentException("Screen size changed; use the recorded display size and orientation");
        GestureDescription.Builder b=new GestureDescription.Builder();
        JSONArray ss=a.getJSONArray("strokes");
        if(ss.length()==0 || ss.length()>GestureDescription.getMaxStrokeCount()) throw new IllegalArgumentException("Unsupported pointer count");
        for(int i=0;i<ss.length();i++) {
            JSONObject s=ss.getJSONObject(i); JSONArray points=s.getJSONArray("points"); Path path=new Path();
            for(int j=0;j<points.length();j++) {
                JSONArray p=points.getJSONArray(j); float x=(float)p.getDouble(0),y=(float)p.getDouble(1);
                x=Math.max(0,Math.min(width-1,x)); y=Math.max(0,Math.min(height-1,y));
                if(j==0) path.moveTo(x,y); else path.lineTo(x,y);
            }
            b.addStroke(new GestureDescription.StrokeDescription(path,s.getLong("startMs"),s.getLong("durationMs")));
        }
        return b.build();
    }
}
