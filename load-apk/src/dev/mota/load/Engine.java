package dev.mota.load;

import android.content.Context;
import android.os.Process;
import android.os.SharedMemory;
import android.os.SystemClock;
import android.system.Os;
import android.system.OsConstants;
import org.json.JSONObject;
import java.io.File;
import java.io.FileDescriptor;
import java.io.RandomAccessFile;
import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.Random;

/**
 * The load one app puts on the phone: memory it holds, CPU it burns, disk it writes and files it keeps.
 * One per process. A new configuration replaces the old one.
 */
final class Engine {
    static final Engine I = new Engine();
    private static final int CHUNK_MB = 16, PAGE = 4096;

    private final long startedAt = SystemClock.elapsedRealtime();
    private final ArrayList<SharedMemory> regions = new ArrayList<>();
    private final ArrayList<ByteBuffer> maps = new ArrayList<>();
    private final byte[] noise = new byte[1 << 20];
    /** Workers of an older configuration stop when this changes. */
    private volatile int generation;
    private volatile JSONObject config = new JSONObject();
    volatile int memHeldMb, filesHeldMb;
    volatile long ioWrittenMb;
    volatile String error = "";

    private Engine() { new Random().nextBytes(noise); }

    JSONObject config() { return config; }

    /**
     * memMb: memory to hold. randomPercent: how much of each page is random (the rest is zeros, which Android compresses away).
     * cpuThreads and cpuPercent: busy threads and how busy. ioMbps: MB written and synced per second.
     * filesMb and filesIn ("data" or "cache"): storage to keep.
     */
    synchronized void apply(Context context, JSONObject cfg) {
        final int gen = ++generation;
        config = cfg;
        error = "";
        final int memMb = Math.max(0, cfg.optInt("memMb")), randomPercent = Math.min(100, Math.max(0, cfg.optInt("randomPercent", 40)));
        thread("memory", () -> holdMemory(gen, memMb, randomPercent));
        int threads = Math.min(16, Math.max(0, cfg.optInt("cpuThreads"))), percent = Math.min(100, Math.max(0, cfg.optInt("cpuPercent")));
        for (int i = 0; i < threads && percent > 0; i++) thread("cpu" + i, () -> burn(gen, percent));
        final int ioMbps = Math.min(500, Math.max(0, cfg.optInt("ioMbps")));
        final File cache = context.getCacheDir();
        if (ioMbps > 0) thread("io", () -> churn(gen, new File(cache, "io.bin"), ioMbps));
        final int filesMb = Math.max(0, cfg.optInt("filesMb"));
        final File dir = "cache".equals(cfg.optString("filesIn")) ? cache : context.getFilesDir();
        final File other = dir == cache ? context.getFilesDir() : cache;
        thread("files", () -> holdFiles(gen, new File(dir, "held.bin"), new File(other, "held.bin"), filesMb));
    }

    private interface Work { void run() throws Exception; }

    private void thread(String name, Work r) {
        Thread t = new Thread(() -> { try { r.run(); } catch (Throwable e) { error = name + ": " + e; } }, "load-" + name);
        t.setDaemon(true);
        t.start();
    }

    private void holdMemory(int gen, int targetMb, int randomPercent) {
        synchronized (regions) {
            while (memHeldMb > targetMb && !regions.isEmpty()) {
                SharedMemory.unmap(maps.remove(maps.size() - 1));
                regions.remove(regions.size() - 1).close();
                memHeldMb -= CHUNK_MB;
            }
            // Shared memory is outside the Java heap, so it is not capped by the app heap limit.
            while (memHeldMb < targetMb && gen == generation) {
                try {
                    SharedMemory region = SharedMemory.create("mota-load", CHUNK_MB << 20);
                    ByteBuffer map = region.mapReadWrite();
                    fill(map, randomPercent, regions.size());
                    regions.add(region);
                    maps.add(map);
                    memHeldMb += CHUNK_MB;
                } catch (Throwable e) { error = "memory: stopped at " + memHeldMb + " MB: " + e; return; }
            }
        }
    }

    /** Writes every page, so the memory is really used. Pages differ from each other, so they cannot be merged. */
    private void fill(ByteBuffer map, int randomPercent, int index) {
        int random = PAGE * randomPercent / 100;
        for (int offset = 0, page = 0; offset < map.capacity(); offset += PAGE, page++) {
            map.position(offset);
            map.putInt(index).putInt(page);
            if (random > 8) map.put(noise, (int) (((long) index * 7919 + page * 131L) % (noise.length - PAGE)), random - 8);
        }
    }

    private void burn(int gen, int percent) {
        Process.setThreadPriority(Process.THREAD_PRIORITY_DEFAULT);
        double x = 1;
        while (gen == generation) {
            long start = System.nanoTime();
            while (System.nanoTime() - start < percent * 1_000_000L) x = Math.sqrt(x + 1.5) * 1.0001;
            if (percent < 100) SystemClock.sleep(100 - percent);
        }
        if (x < 0) error = "cpu";
    }

    private void churn(int gen, File file, int mbps) throws Exception {
        byte[] chunk = new byte[1 << 20];
        try (RandomAccessFile out = new RandomAccessFile(file, "rw")) {
            while (gen == generation) {
                long second = SystemClock.elapsedRealtime();
                for (int i = 0; i < mbps && gen == generation; i++) {
                    System.arraycopy(noise, (int) (ioWrittenMb % 64) * PAGE, chunk, 0, PAGE);
                    if (out.getFilePointer() >= 64L << 20) out.seek(0);
                    out.write(chunk);
                    out.getFD().sync();
                    ioWrittenMb++;
                }
                long left = 1000 - (SystemClock.elapsedRealtime() - second);
                if (left > 0) SystemClock.sleep(left);
            }
        } finally { file.delete(); }
    }

    private void holdFiles(int gen, File file, File other, int mb) throws Exception {
        other.delete();
        if (mb == 0) { file.delete(); filesHeldMb = 0; return; }
        FileDescriptor fd = Os.open(file.getPath(), OsConstants.O_RDWR | OsConstants.O_CREAT | OsConstants.O_TRUNC, 0600);
        try { Os.posix_fallocate(fd, 0, (long) mb << 20); } finally { Os.close(fd); }
        if (gen == generation) filesHeldMb = (int) (file.length() >> 20);
    }

    JSONObject status(Context context) throws Exception {
        return new JSONObject().put("package", context.getPackageName()).put("pid", Process.myPid())
            .put("uptimeMs", SystemClock.elapsedRealtime() - startedAt)
            .put("memHeldMb", memHeldMb).put("filesHeldMb", filesHeldMb).put("ioWrittenMb", ioWrittenMb)
            .put("service", LoadService.running).put("screen", LoadActivity.shown)
            .put("error", error).put("config", config);
    }
}
