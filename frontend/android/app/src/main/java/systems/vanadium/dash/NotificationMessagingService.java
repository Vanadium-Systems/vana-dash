package systems.vanadium.dash;

import android.app.NotificationManager;
import android.service.notification.StatusBarNotification;

import androidx.annotation.NonNull;

import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/**
 * Closes a notification read on another device, and rings for an incoming call. Both have to
 * happen here: the WebView is not running when the app is closed.
 */
public class NotificationMessagingService extends MessagingService {
    @Override
    public void onMessageReceived(@NonNull RemoteMessage message) {
        Map<String, String> data = message.getData();
        String type = data.get("type");
        if ("close".equals(type)) {
            String tag = data.get("tag");
            close(tag);
            // Answered, declined or ended somewhere else.
            if (tag != null && tag.startsWith("call-")) IncomingCallActivity.finishFor(tag.substring("call-".length()));
            return;
        }
        if ("call".equals(type)) {
            // With the app on screen the web app shows the call and rings itself.
            if (!MainActivity.isForeground()) CallNotifications.showIncoming(this, data);
            return;
        }
        super.onMessageReceived(message);
    }

    private void close(String tag) {
        if (tag == null) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        for (StatusBarNotification shown : manager.getActiveNotifications()) {
            if (tag.equals(shown.getTag())) manager.cancel(tag, shown.getId());
        }
    }
}
