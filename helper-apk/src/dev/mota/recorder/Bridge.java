package dev.mota.recorder;
import android.content.Context;
import android.net.*;
import android.os.*;
import android.util.Base64;
import org.json.*;
import java.io.*;
import java.security.*;
import java.util.concurrent.*;

/** Authenticated JSON-lines over an abstract Unix socket, forwarded by ADB only. */
final class Bridge {
    private static Bridge instance;
    final String token;
    final Context context;
    final Handler main=new Handler(Looper.getMainLooper());
    final LocalServerSocket server;
    final ExecutorService clients=Executors.newFixedThreadPool(2);
    static synchronized Bridge ensure(Context c)throws Exception {if(instance==null)instance=new Bridge(c);return instance;}
    private Bridge(Context c)throws Exception {
        context=c.getApplicationContext();
        android.content.SharedPreferences prefs=context.getSharedPreferences("bridge",0);
        String saved=prefs.getString("token",null);
        if(saved==null){byte[] bytes=new byte[32];new SecureRandom().nextBytes(bytes);saved=Base64.encodeToString(bytes,Base64.NO_WRAP);prefs.edit().putString("token",saved).apply();}
        token=saved;server=new LocalServerSocket("mota.recorder");
        Thread accept=new Thread(()->{while(true){try{LocalSocket socket=server.accept();int peer=socket.getPeerCredentials().getUid();if(peer!=0&&peer!=2000){socket.close();continue;}socket.setSoTimeout(15000);clients.submit(()->serve(socket));}catch(Exception e){break;}}},"mota-bridge");accept.setDaemon(true);accept.start();
    }
    void serve(LocalSocket socket){
        try(LocalSocket connection=socket){
            int uid=connection.getPeerCredentials().getUid();if(uid!=0&&uid!=2000)return;
            ByteArrayOutputStream bytes=new ByteArrayOutputStream();InputStream in=connection.getInputStream();int b;
            while((b=in.read())!=-1&&b!='\n'){if(bytes.size()>=8*1024*1024)throw new IOException("Request too large");bytes.write(b);}
            JSONObject request=new JSONObject(bytes.toString("UTF-8"));
            if(!MessageDigest.isEqual(token.getBytes("UTF-8"),request.optString("token").getBytes("UTF-8")))return;
            JSONObject response=new JSONObject().put("id",request.optString("id"));
            try {response.put("result",handle(request));}catch(Exception e){response.put("error",e.getMessage()==null?"Command failed":e.getMessage());}
            connection.getOutputStream().write((response.toString()+"\n").getBytes("UTF-8"));
        }catch(Exception ignored){/* Never log tokens or session content. */}
    }
    JSONObject handle(JSONObject request)throws Exception {
        String op=request.getString("op");JSONObject p=request.optJSONObject("params");if(p==null)p=new JSONObject();
        if(op.equals("sessions")){
            JSONArray list=new JSONArray();for(File f:SessionStore.list(context)){try{JSONObject d=SessionStore.read(f);list.put(new JSONObject().put("id",f.getName()).put("count",d.getJSONArray("actions").length()).put("finished",d.optBoolean("finished")).put("videoStatus",d.optString("videoStatus")));}catch(Exception ignored){}}
            return new JSONObject().put("sessions",list);
        }
        if(op.equals("files")||op.equals("read")){
            String id=p.getString("session");if(!id.matches("[A-Za-z0-9_-]{1,100}"))throw new IOException("Invalid session ID");
            File dir=new File(SessionStore.root(context),id);
            RecorderService live=RecorderService.live;
            if(live!=null&&live.session!=null&&live.session.dir.equals(dir)&&(live.recording||live.busy||live.shotsPending>0||CaptureService.active))throw new IOException("Stop and wait for capture finalization before downloading");
            if(op.equals("files")){JSONArray files=new JSONArray();collect(dir,dir,files);return new JSONObject().put("files",files);}
            String path=p.getString("path");if(!path.matches("actions\\.json|screen\\.mp4|screenshots/[0-9]+\\.png"))throw new IOException("Invalid file path");
            File file=new File(dir,path);long offset=p.getLong("offset");if(offset<0||offset>file.length())throw new IOException("Invalid offset");
            byte[] data=new byte[(int)Math.min(262144,file.length()-offset)];
            try(RandomAccessFile f=new RandomAccessFile(file,"r")){f.seek(offset);f.readFully(data);}
            return new JSONObject().put("data",Base64.encodeToString(data,Base64.NO_WRAP)).put("eof",offset+data.length==file.length());
        }
        final JSONObject params=p;
        FutureTask<JSONObject> task=new FutureTask<>(()->{
            RecorderService s=RecorderService.live;
            if(op.equals("status"))return status(s);
            if(s==null)throw new IOException("Enable MoTA Recorder in Accessibility settings");
            switch(op){
                case "controls":s.showControls(null);break;
                case "start":
                    if(s.recording||s.playing||s.busy||s.shotsPending>0||CaptureService.active)throw new IOException("Device already busy");
                    s.startSession("adb".equals(params.optString("mode")));if(!s.recording)throw new IOException("Recording did not start");
                    break;
                case "cancelVideo":if(MainActivity.visible!=null)MainActivity.visible.cancelRemoteVideo();s.stopEverything("Video request cancelled from MoTA");break;
                case "stop":case "cancel":s.stopEverything("Stopped from MoTA");break;
                case "shot":s.screenshot(params.optInt("actionIndex",-1),false);break;
                case "replay":
                    if(s.recording||s.playing||s.busy||s.shotsPending>0||CaptureService.active)throw new IOException("Device already busy");
                    JSONObject data=params.getJSONObject("session");validate(data,s);
                    File dir=new File(SessionStore.root(context),"import-"+java.util.UUID.randomUUID());if(!dir.mkdirs())throw new IOException("Cannot import session");
                    try(FileOutputStream out=new FileOutputStream(new File(dir,"actions.json"))){out.write(data.toString().getBytes("UTF-8"));}
                    s.selected=dir;s.showControls(dir);s.replaySelected();if(!s.playing)throw new IOException(s.message);break;
                default:throw new IOException("Unknown command");
            }
            return status(s);
        });
        main.post(task);try{return task.get(12,TimeUnit.SECONDS);}catch(TimeoutException e){task.cancel(false);throw new IOException("Device main thread is busy; command timed out");}
    }
    void collect(File root,File dir,JSONArray result)throws Exception{
        File[] files=dir.listFiles();if(files==null)throw new IOException("Session unavailable");
        for(File f:files){if(f.isDirectory()){if(f.getName().equals("screenshots"))collect(root,f,result);}else{
            String path=f.getAbsolutePath().substring(root.getAbsolutePath().length()+1);
            if(path.matches("actions\\.json|screen\\.mp4|screenshots/[0-9]+\\.png"))result.put(new JSONObject().put("path",path).put("size",f.length()));
        }}
    }
    JSONObject status(RecorderService s)throws Exception{
        JSONObject r=new JSONObject().put("protocol",1).put("version","0.2.0").put("ready",s!=null).put("videoActive",CaptureService.active);
        if(s!=null){r.put("recording",s.recording).put("playing",s.playing).put("paused",s.paused).put("busy",s.busy||s.shotsPending>0).put("message",s.message)
            .put("width",s.width()).put("height",s.height()).put("rotation",s.rotation()).put("replayIndex",s.replayIndex).put("replayTotal",s.replayTotal);
            if(s.session!=null)r.put("session",s.session.dir.getName()).put("mode",s.passiveRecording?"adb":"overlay").put("actions",s.session.actions.length()).put("uptimeStartMs",s.session.data.optLong("uptimeStartMs")).put("videoStatus",s.session.data.optString("videoStatus"));
        }return r;
    }
    void validate(JSONObject d,RecorderService s)throws Exception{
        if(d.getInt("schemaVersion")!=1||!s.sameDisplay(d))throw new IOException("Session schema or display does not match");
        JSONArray actions=d.getJSONArray("actions");if(actions.length()<1||actions.length()>10000)throw new IOException("Unsupported action count");
        long total=0;
        for(int i=0;i<actions.length();i++){
            JSONObject a=actions.getJSONObject(i);long delay=a.getLong("delayMs");if(delay<0||delay>86400000)throw new IOException("Invalid delay");total+=delay;
            switch(a.getString("type")){
                case "gesture":if(!s.sameDisplay(a)||!"completed".equals(a.optString("dispatch")))throw new IOException("Incomplete gesture");GestureCodec.build(a,s.width(),s.height());break;
                case "global":if(a.getInt("action")!=1&&a.getInt("action")!=2&&a.getInt("action")!=3)throw new IOException("Unsupported navigation action");break;
                case "volume":if(a.getInt("keyCode")!=24&&a.getInt("keyCode")!=25)throw new IOException("Unsupported key");break;
                case "text":if(a.getString("text").length()>100000)throw new IOException("Text too long");break;
                default:throw new IOException("Unknown action type");
            }
        }
        if(total>86400000)throw new IOException("Session exceeds 24 hours");
    }
}
