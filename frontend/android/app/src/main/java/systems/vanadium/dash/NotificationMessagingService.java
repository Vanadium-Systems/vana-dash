package systems.vanadium.dash;

import android.app.NotificationManager;
import android.service.notification.StatusBarNotification;

import androidx.annotation.NonNull;

import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/**
 * Closes a notification read on another device. This has to happen here: the WebView is not
 * running when the app is closed, and that is when the notification sits in the shade.
 */
public class NotificationMessagingService extends MessagingService {
    @Override
    public void onMessageReceived(@NonNull RemoteMessage message) {
        Map<String, String> data = message.getData();
        if ("close".equals(data.get("type"))) {
            close(data.get("tag"));
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
