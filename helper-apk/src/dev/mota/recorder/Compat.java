package dev.mota.recorder;
import android.accessibilityservice.AccessibilityService;
import android.graphics.*;
import android.hardware.HardwareBuffer;
import android.os.Build;
import android.view.*;
import java.util.concurrent.Executor;

/**
 * Android 10 (API 29) fallbacks. Android 11+ code lives in {@link Api30} so Android 10 never loads classes that reference missing APIs.
 */
final class Compat {
    static final boolean API30=Build.VERSION.SDK_INT>=30;

    /** Receives an ARGB_8888 bitmap the receiver must recycle, or an error message. May run on any thread. */
    interface FrameCallback { void done(Bitmap bitmap,String error); }

    /** Full display size in the current rotation, including system bars. */
    static Point displaySize(WindowManager wm){
        if(API30)return Api30.displaySize(wm);
        Point size=new Point();wm.getDefaultDisplay().getRealSize(size);return size;
    }

    /** Draws behind transparent system bars and pads {@code padded} by the bar insets that {@code target} receives. */
    static void edgeToEdge(Window window,View target,View padded,int left,int top,int right,int bottom){
        if(API30){Api30.edgeToEdge(window,target,padded,left,top,right,bottom);return;}
        window.setStatusBarColor(Color.TRANSPARENT);window.setNavigationBarColor(Color.TRANSPARENT);
        View decor=window.getDecorView();
        decor.setSystemUiVisibility(decor.getSystemUiVisibility()|View.SYSTEM_UI_FLAG_LAYOUT_STABLE|View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN|View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        target.setOnApplyWindowInsetsListener((v,insets)->{
            padded.setPadding(left+insets.getSystemWindowInsetLeft(),top+insets.getSystemWindowInsetTop(),right+insets.getSystemWindowInsetRight(),bottom+insets.getSystemWindowInsetBottom());
            return insets;
        });
    }

    /** Lets an overlay cover cutouts and system bars. */
    static void coverWholeScreen(WindowManager.LayoutParams p){
        if(API30)Api30.coverWholeScreen(p);
        else p.layoutInDisplayCutoutMode=WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
    }

    static final class Api30 {
        static void coverWholeScreen(WindowManager.LayoutParams p){p.layoutInDisplayCutoutMode=WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS;p.setFitInsetsTypes(0);}

        static Point displaySize(WindowManager wm){Rect r=wm.getMaximumWindowMetrics().getBounds();return new Point(r.width(),r.height());}

        static void edgeToEdge(Window window,View target,View padded,int left,int top,int right,int bottom){
            window.setDecorFitsSystemWindows(false);
            target.setOnApplyWindowInsetsListener((v,insets)->{
                Insets bars=insets.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.displayCutout());
                padded.setPadding(left+bars.left,top+bars.top,right+bars.right,bottom+bars.bottom);
                return insets;
            });
        }

        /** Accessibility screenshot (Android 11+). */
        static void screenshot(AccessibilityService service,Executor executor,FrameCallback callback){
            service.takeScreenshot(Display.DEFAULT_DISPLAY,executor,new AccessibilityService.TakeScreenshotCallback(){
                @Override public void onSuccess(AccessibilityService.ScreenshotResult result){
                    HardwareBuffer buffer=result.getHardwareBuffer();Bitmap hardware=null,bitmap=null;String error=null;
                    try{
                        hardware=Bitmap.wrapHardwareBuffer(buffer,result.getColorSpace());
                        if(hardware==null)throw new IllegalStateException("Cannot read screenshot");
                        bitmap=hardware.copy(Bitmap.Config.ARGB_8888,false);
                    }catch(Exception e){error="Screenshot failed: "+e.getMessage();}
                    finally{if(hardware!=null)hardware.recycle();buffer.close();}
                    callback.done(bitmap,error);
                }
                @Override public void onFailure(int code){callback.done(null,"Screenshot denied, code "+code);}
            });
        }
    }
}
