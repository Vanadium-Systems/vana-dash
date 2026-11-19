package systems.vanadium.dash;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.Person;

import java.util.Map;
import java.util.regex.Pattern;

/** The incoming call notification: rings like the phone does, and opens the call screen. */
final class CallNotifications {
    static final String CHANNEL_RING = "calls";
    static final String CHANNEL_ONGOING = "call_ongoing";
    static final int RING_ID = 4100;
    static final int ONGOING_ID = 4101;
    // Same as CALL_RING_MS in the backend and RING_TIMEOUT_MS in IncomingCallOverlay.
    static final long RING_MS = 45_000;

    static final String ACTION_ANSWER = "systems.vanadium.dash.ANSWER_CALL";
    static final String ACTION_DECLINE = "systems.vanadium.dash.DECLINE_CALL";
    static final String ACTION_HANGUP = "systems.vanadium.dash.HANGUP_CALL";

    static final String EXTRA_CALL_ID = "callId";
    static final String EXTRA_URL = "url";
    static final String EXTRA_TITLE = "title";
    static final String EXTRA_BODY = "body";
    static final String EXTRA_KIND = "kind";
    static final String EXTRA_ANSWER = "answer";
    static final String EXTRA_DECLINE = "decline";

    private static final long[] VIBRATION = {0, 1000, 800, 1000, 800};
    private static final Pattern CALL_ID = Pattern.compile("^[0-9a-f-]{36}$");

    private CallNotifications() {}

    static boolean isCallId(String value) {
        return value != null && CALL_ID.matcher(value).matches();
    }

    static String tagFor(String callId) {
        return "call-" + callId;
    }

    static void ensureChannels(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        NotificationChannel ring = new NotificationChannel(CHANNEL_RING, context.getString(R.string.channel_calls), NotificationManager.IMPORTANCE_HIGH);
        ring.setSound(
            RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),
            new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()
        );
        ring.enableVibration(true);
        ring.setVibrationPattern(VIBRATION);
        ring.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        manager.createNotificationChannel(ring);

        NotificationChannel ongoing = new NotificationChannel(CHANNEL_ONGOING, context.getString(R.string.channel_call_ongoing), NotificationManager.IMPORTANCE_LOW);
        ongoing.setSound(null, null);
        manager.createNotificationChannel(ongoing);
    }

    static void showIncoming(Context context, Map<String, String> data) {
        String callId = data.get("callId");
        if (!isCallId(callId)) return;
        ensureChannels(context);

        String title = valueOr(data.get("title"), context.getString(R.string.app_name));
        String body = valueOr(data.get("body"), "");
        String url = safeUrl(data.get("url"), callId);

        Intent screen = new Intent(context, IncomingCallActivity.class)
            .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_USER_ACTION)
            .putExtra(EXTRA_CALL_ID, callId)
            .putExtra(EXTRA_URL, url)
            .putExtra(EXTRA_TITLE, title)
            .putExtra(EXTRA_BODY, body)
            .putExtra(EXTRA_KIND, data.get("kind"))
            .putExtra(EXTRA_ANSWER, data.get("answer"))
            .putExtra(EXTRA_DECLINE, data.get("decline"));
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        PendingIntent screenIntent = PendingIntent.getActivity(context, callId.hashCode(), screen, flags);
        PendingIntent answerIntent = PendingIntent.getActivity(context, callId.hashCode() + 1, answerIntent(context, callId, url), flags);
        PendingIntent declineIntent = PendingIntent.getBroadcast(context, callId.hashCode() + 2, declineIntent(context, callId), flags);

        Person caller = new Person.Builder().setName(title).setImportant(true).build();
        Uri ringtone = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
        Notification notification = new NotificationCompat.Builder(context, CHANNEL_RING)
            .setSmallIcon(R.drawable.ic_stat_call)
            .setContentTitle(title)
            .setContentText(body)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .setTimeoutAfter(RING_MS)
            .setContentIntent(screenIntent)
            .setFullScreenIntent(screenIntent, true)
            // Android 7 has no channels: sound and vibration go on the notification itself.
            .setSound(ringtone, AudioManager.STREAM_RING)
            .setVibrate(VIBRATION)
            .setStyle(NotificationCompat.CallStyle.forIncomingCall(caller, declineIntent, answerIntent))
            .build();
        // Rings and vibrates until answered, declined or timed out, not just once.
        notification.flags |= Notification.FLAG_INSISTENT;
        context.getSystemService(NotificationManager.class).notify(tagFor(callId), RING_ID, notification);
    }

    static void cancelRing(Context context, String callId) {
        if (!isCallId(callId)) return;
        context.getSystemService(NotificationManager.class).cancel(tagFor(callId), RING_ID);
    }

    static Intent answerIntent(Context context, String callId, String url) {
        return new Intent(context, MainActivity.class)
            .setAction(ACTION_ANSWER)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(EXTRA_CALL_ID, callId)
            .putExtra(EXTRA_URL, url);
    }

    static Intent declineIntent(Context context, String callId) {
        return new Intent(context, CallActionReceiver.class).setAction(ACTION_DECLINE).putExtra(EXTRA_CALL_ID, callId);
    }

    private static String safeUrl(String url, String callId) {
        // Only an in-app path: the WebView would open anything else.
        if (url != null && url.startsWith("/") && !url.startsWith("//")) return url;
        return "/calls/" + callId;
    }

    private static String valueOr(String value, String fallback) {
        return value == null || value.isEmpty() ? fallback : value;
    }
}
