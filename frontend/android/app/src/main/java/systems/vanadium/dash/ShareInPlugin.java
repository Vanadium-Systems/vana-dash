package systems.vanadium.dash;

import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;

/**
 * Share target — „Share → VanaDash" din orice aplicație (ca Share to Drive).
 * Colectează URI-urile din ACTION_SEND/SEND_MULTIPLE, le copiază pe rând în cache-ul
 * aplicației (readNext) și JS le urcă în Arhivă cu sesiunea din WebView.
 */
@CapacitorPlugin(name = "ShareIn")
public class ShareInPlugin extends Plugin {
    private final ArrayList<Uri> pendingUris = new ArrayList<>();

    @Override
    public void load() {
        super.load();
        collectFromIntent(getActivity().getIntent());
        // Fără notify aici — la cold start JS-ul nu e încă atașat; el interoghează isPending
        // la mount, deci nimic nu se pierde.
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        collectFromIntent(intent);
        if (!pendingUris.isEmpty()) notifyListeners("pendingShare", new JSObject());
    }

    private void collectFromIntent(Intent intent) {
        if (intent == null || intent.getAction() == null) return;
        if (Intent.ACTION_SEND.equals(intent.getAction())) {
            Uri uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (uri != null) {
                pendingUris.clear();
                pendingUris.add(uri);
            }
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(intent.getAction())) {
            ArrayList<Uri> uris = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (uris != null && !uris.isEmpty()) {
                pendingUris.clear();
                pendingUris.addAll(uris);
            }
        }
        // Share de text gol (fără EXTRA_STREAM) — ignorat intenționat, isPending rămâne fals.
    }

    @PluginMethod
    public void isPending(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("count", pendingUris.size());
        call.resolve(ret);
    }

    // Copiază următorul URI în cache și returnează {path, name, mimeType} — path e relativ
    // la Directory.Cache, citibil din JS prin @capacitor/filesystem.
    @PluginMethod
    public void readNext(PluginCall call) {
        if (pendingUris.isEmpty()) {
            call.resolve(new JSObject());
            return;
        }
        Uri uri = pendingUris.remove(0);
        String name = queryDisplayName(uri);
        String mime = getActivity().getContentResolver().getType(uri);

        File dir = new File(getActivity().getCacheDir(), "share-in");
        if (!dir.exists() && !dir.mkdirs()) {
            call.reject("Nu pot crea directorul cache share-in");
            return;
        }
        File outFile = new File(dir, System.currentTimeMillis() + "-" + sanitize(name));
        try (InputStream in = getActivity().getContentResolver().openInputStream(uri);
             FileOutputStream out = new FileOutputStream(outFile)) {
            if (in == null) throw new IOException("ContentResolver a returnat null pentru " + uri);
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        } catch (IOException | SecurityException e) {
            call.reject("Citirea fișierului partajat a eșuat: " + e.getMessage());
            return;
        }

        JSObject ret = new JSObject();
        // Cale relativă la rădăcina Cache — Filesystem.readFile din JS rezolvă path-ul sub
        // directorul dat, iar fișierul scrie în cacheDir/share-in/ (bug găsit 2026-08-24:
        // doar numele ducea readFile la ENOENT și share-ul murea silențios).
        ret.put("path", "share-in/" + outFile.getName());
        ret.put("name", name);
        ret.put("mimeType", mime != null ? mime : "application/octet-stream");
        call.resolve(ret);
    }

    private String sanitize(String name) {
        String cleaned = name.replaceAll("[\\\\/:*?\"<>|]", "_");
        return cleaned.isBlank() ? "shared-" + System.currentTimeMillis() : cleaned;
    }

    @PluginMethod
    public void clear(PluginCall call) {
        pendingUris.clear();
        File dir = new File(getActivity().getCacheDir(), "share-in");
        File[] leftovers = dir.listFiles();
        if (leftovers != null) {
            for (File f : leftovers) f.delete();
        }
        call.resolve();
    }

    private String queryDisplayName(Uri uri) {
        try (Cursor c = getActivity().getContentResolver().query(uri, null, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                int idx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (idx >= 0) {
                    String name = c.getString(idx);
                    if (name != null && !name.isBlank()) return name;
                }
            }
        } catch (Exception ignored) {
            // Fără nume afișabil — cădem pe unul generic cu timestamp.
        }
        return "shared-" + System.currentTimeMillis();
    }
}
