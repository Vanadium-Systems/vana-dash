package systems.vanadium.dash;

import android.net.Uri;
import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import android.webkit.WebView;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.PickVisualMediaRequest;
import androidx.activity.result.contract.ActivityResultContracts.PickMultipleVisualMedia;
import androidx.activity.result.contract.ActivityResultContracts.PickVisualMedia;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

import java.util.List;

public class MainActivity extends BridgeActivity {
    private static final int MAX_PICKED_MEDIA = 20;

    private ActivityResultLauncher<PickVisualMediaRequest> mediaPicker;
    private ValueCallback<Uri[]> pendingMediaCallback;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Obligatoriu ÎNĂINTE de super.onCreate(): acolo BridgeActivity.load() creează bridge-ul,
        // iar un plugin înregistrat după ajunge într-un builder deja consumat → „not implemented"
        // (găsit live 2026-08-24: share-in murea cu eroarea asta în loc de upload).
        registerPlugin(ShareInPlugin.class);
        super.onCreate(savedInstanceState);

        mediaPicker = registerForActivityResult(new PickMultipleVisualMedia(MAX_PICKED_MEDIA), this::deliverPickedMedia);
        bridge.getWebView().setWebChromeClient(new MediaPickerChromeClient());
    }

    @Override
    public void onStop() {
        super.onStop();
        // Swipe-kill din recents = SIGKILL fără onDestroy; Chromium flush-uiește
        // cookie-urile asincron, deci fără flush() explicit sesiunea se pierde.
        CookieManager.getInstance().flush();
    }

    private void deliverPickedMedia(List<Uri> uris) {
        if (pendingMediaCallback == null) return;
        pendingMediaCallback.onReceiveValue(uris.isEmpty() ? null : uris.toArray(new Uri[0]));
        pendingMediaCallback = null;
    }

    /**
     * Un <input type="file"> care cere doar poze/videouri (Galeria din Mesaje) deschide
     * selectorul de poze al sistemului, ca la WhatsApp, nu alegătorul generic de fișiere
     * (pe Samsung, „Fișierele mele"). Nu cere permisiuni: sistemul dă acces doar la ce alege
     * omul. Camera (capture) și restul fișierelor rămân pe comportamentul Capacitor.
     */
    private class MediaPickerChromeClient extends BridgeWebChromeClient {
        MediaPickerChromeClient() {
            super(bridge);
        }

        @Override
        public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (params.isCaptureEnabled() || !acceptsOnlyMedia(params.getAcceptTypes())) {
                return super.onShowFileChooser(webView, callback, params);
            }
            // Un selector rămas deschis (activitatea recreată) nu primește niciodată rezultat;
            // WebView-ul refuză alt selector cât timp callback-ul vechi n-a răspuns.
            if (pendingMediaCallback != null) pendingMediaCallback.onReceiveValue(null);
            pendingMediaCallback = callback;
            mediaPicker.launch(
                new PickVisualMediaRequest.Builder().setMediaType(PickVisualMedia.ImageAndVideo.INSTANCE).build()
            );
            return true;
        }

        private boolean acceptsOnlyMedia(String[] acceptTypes) {
            boolean any = false;
            for (String entry : acceptTypes) {
                // WebView trimite uneori tot atributul `accept` ca un singur element.
                for (String type : entry.split(",")) {
                    String trimmed = type.trim();
                    if (trimmed.isEmpty()) continue;
                    if (!trimmed.startsWith("image/") && !trimmed.startsWith("video/")) return false;
                    any = true;
                }
            }
            return any;
        }
    }
}
