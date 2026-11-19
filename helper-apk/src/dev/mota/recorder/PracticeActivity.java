package dev.mota.recorder;

import android.app.Activity;
import android.os.Bundle;
import android.view.*;
import android.widget.*;
import android.graphics.*;

/** Local surface for testing injected gestures without touching external apps. */
public class PracticeActivity extends Activity {
    @Override public void onCreate(Bundle b){
        super.onCreate(b);getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR|View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);LinearLayout layout=new LinearLayout(this);layout.setOrientation(1);layout.setPadding(20,20,20,20);Compat.edgeToEdge(getWindow(),layout,layout,20,20,20,20);
        TextView title=new TextView(this);title.setText("Practice pad • record here, then replay");title.setTextSize(20);layout.addView(title);
        final int[] count={0};Button tap=new Button(this);tap.setText("Taps: 0");layout.addView(tap);
        tap.setOnClickListener(v->{count[0]++;tap.setText("Taps: "+count[0]);});
        tap.setOnLongClickListener(v->{tap.setText("Long press received");return true;});
        EditText input=new EditText(this);input.setHint("Focus here, then use toolbar Text");layout.addView(input);
        layout.addView(new Pad(),new LinearLayout.LayoutParams(-1,0,1));setContentView(layout);
    }
    class Pad extends View {
        Paint paint=new Paint(3);Path path=new Path();String state="Draw, swipe, or pinch here";int maxPointers;long start;
        Pad(){super(PracticeActivity.this);setBackgroundColor(0xFFE5F7F1);}
        @Override public boolean onTouchEvent(MotionEvent e){
            if(e.getActionMasked()==MotionEvent.ACTION_DOWN){path.reset();path.moveTo(e.getX(),e.getY());start=e.getEventTime();maxPointers=0;}
            maxPointers=Math.max(maxPointers,e.getPointerCount());path.lineTo(e.getX(),e.getY());
            state="Pointers: "+maxPointers+" • "+(e.getEventTime()-start)+" ms";invalidate();return true;
        }
        @Override public void onDraw(Canvas c){paint.setColor(0xFF147D64);paint.setStrokeWidth(7);paint.setStyle(Paint.Style.STROKE);c.drawPath(path,paint);paint.setStyle(Paint.Style.FILL);paint.setTextSize(35);c.drawText(state,20,50,paint);}
    }
}
