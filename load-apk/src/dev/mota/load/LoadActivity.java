package dev.mota.load;

import android.app.Activity;
import android.os.Bundle;
import android.view.Gravity;
import android.widget.TextView;

/** A screen, so the app sits in recents like any app the user opened and left. */
public class LoadActivity extends Activity {
    static volatile boolean shown;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        TextView text = new TextView(this);
        text.setGravity(Gravity.CENTER);
        text.setTextSize(18);
        text.setText(getApplicationInfo().loadLabel(getPackageManager()) + "\n\nStands in for another app during a MoTA pressure test.");
        setContentView(text);
    }

    @Override protected void onStart() { super.onStart(); shown = true; }
    @Override protected void onStop() { shown = false; super.onStop(); }
}
