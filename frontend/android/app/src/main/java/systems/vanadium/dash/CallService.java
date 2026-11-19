package systems.vanadium.dash;

import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

import androidx.core.app.NotificationCompat;
import androidx.core.app.Person;

/**
 * Keeps the call alive while the screen is off or the app is in the background: without a
 * foreground service Android cuts a background app off from the microphone.
 */
public class CallService extends Service {
    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        CallNotifications.ensureChannels(this);
        String title = intent != null ? intent.getStringExtra(CallNotifications.EXTRA_TITLE) : null;
        String body = intent != null ? intent.getStringExtra(CallNotifications.EXTRA_BODY) : null;
        if (title == null || title.isEmpty()) title = getString(R.string.app_name);

        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        PendingIntent open = PendingIntent.getActivity(
            this, 0, new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), piFlags);
        PendingIntent hangupIntent = PendingIntent.getBroadcast(
            this, 1, new Intent(this, CallActionReceiver.class).setAction(CallNotifications.ACTION_HANGUP), piFlags);

        Person person = new Person.Builder().setName(title).build();
        NotificationCompat.CallStyle style = NotificationCompat.CallStyle.forOngoingCall(person, hangupIntent);
        Notification notification = new NotificationCompat.Builder(this, CallNotifications.CHANNEL_ONGOING)
            .setSmallIcon(R.drawable.ic_stat_call)
            .setContentTitle(title)
            .setContentText(body)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setOngoing(true)
            .setUsesChronometer(true)
            .setWhen(System.currentTimeMillis())
            .setContentIntent(open)
            .setStyle(style)
            .build();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            startForeground(CallNotifications.ONGOING_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
        } else {
            startForeground(CallNotifications.ONGOING_ID, notification);
        }
        return START_NOT_STICKY;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // Swiped away from recents: the WebView and the call with it are gone.
        stopSelf();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
