package systems.vanadium.dash;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;
import android.webkit.CookieManager;

import com.getcapacitor.CapConfig;

import java.io.IOException;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** Decline from the notification or the call screen, and hang up from the ongoing call notification. */
public class CallActionReceiver extends BroadcastReceiver {
    private static final String TAG = "VanaDashCall";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (CallNotifications.ACTION_HANGUP.equals(action)) {
            NativeCallPlugin.requestHangup();
            return;
        }
        if (!CallNotifications.ACTION_DECLINE.equals(action)) return;

        String callId = intent.getStringExtra(CallNotifications.EXTRA_CALL_ID);
        if (!CallNotifications.isCallId(callId)) return;
        CallNotifications.cancelRing(context, callId);
        IncomingCallActivity.finishFor(callId);

        String base = CapConfig.loadDefault(context).getServerUrl();
        if (base == null) return;
        // The WebView's session cookie: the app may be closed, so nothing in JS can send this.
        String cookies = CookieManager.getInstance().getCookie(base);
        PendingResult pending = goAsync();
        new Thread(() -> {
            try {
                postDecline(base, callId, cookies);
            } finally {
                pending.finish();
            }
        }).start();
    }

    private static void postDecline(String base, String callId, String cookies) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(base + "/api/chat/calls/" + callId + "/decline").openConnection();
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(10_000);
            connection.setReadTimeout(10_000);
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json");
            if (cookies != null) connection.setRequestProperty("Cookie", cookies);
            try (OutputStream out = connection.getOutputStream()) {
                out.write("{}".getBytes(StandardCharsets.UTF_8));
            }
            int status = connection.getResponseCode();
            if (status >= 300) Log.w(TAG, "decline returned " + status);
        } catch (IOException e) {
            Log.w(TAG, "decline failed: " + e.getMessage());
        } finally {
            if (connection != null) connection.disconnect();
        }
    }
}
