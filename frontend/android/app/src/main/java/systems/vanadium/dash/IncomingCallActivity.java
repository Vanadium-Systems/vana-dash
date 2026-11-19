package systems.vanadium.dash;

import android.app.KeyguardManager;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.WindowManager;
import android.widget.ImageButton;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;

import java.lang.ref.WeakReference;

/** Full screen incoming call, shown over the lock screen by the notification's fullScreenIntent. */
public class IncomingCallActivity extends AppCompatActivity {
    private static WeakReference<IncomingCallActivity> current = new WeakReference<>(null);

    private final Handler handler = new Handler(Looper.getMainLooper());
    private String callId;
    private String url;

    /** Answered, declined or ended elsewhere: close the screen if it shows that call. */
    static void finishFor(String callId) {
        IncomingCallActivity activity = current.get();
        if (activity == null) return;
        activity.runOnUiThread(() -> {
            if (callId == null || callId.equals(activity.callId)) activity.finishAndRemoveTask();
        });
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setContentView(R.layout.activity_incoming_call);
        current = new WeakReference<>(this);

        ImageButton answer = findViewById(R.id.call_answer);
        ImageButton decline = findViewById(R.id.call_decline);
        answer.setOnClickListener(view -> answer());
        decline.setOnClickListener(view -> decline());
        bind(getIntent());
        handler.postDelayed(this::finishAndRemoveTask, CallNotifications.RING_MS);
    }

    @Override
    protected void onNewIntent(@NonNull Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        bind(intent);
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        if (current.get() == this) current = new WeakReference<>(null);
        super.onDestroy();
    }

    private void bind(Intent intent) {
        callId = intent.getStringExtra(CallNotifications.EXTRA_CALL_ID);
        url = intent.getStringExtra(CallNotifications.EXTRA_URL);
        if (!CallNotifications.isCallId(callId)) {
            finishAndRemoveTask();
            return;
        }
        boolean video = "video".equals(intent.getStringExtra(CallNotifications.EXTRA_KIND));
        ((TextView) findViewById(R.id.call_kind)).setText(video ? R.string.call_video : R.string.call_audio);
        ((TextView) findViewById(R.id.call_title)).setText(intent.getStringExtra(CallNotifications.EXTRA_TITLE));
        ((TextView) findViewById(R.id.call_body)).setText(intent.getStringExtra(CallNotifications.EXTRA_BODY));
        setLabel(R.id.call_answer_label, intent.getStringExtra(CallNotifications.EXTRA_ANSWER), R.string.call_answer);
        setLabel(R.id.call_decline_label, intent.getStringExtra(CallNotifications.EXTRA_DECLINE), R.string.call_decline);
        findViewById(R.id.call_answer).setContentDescription(((TextView) findViewById(R.id.call_answer_label)).getText());
        findViewById(R.id.call_decline).setContentDescription(((TextView) findViewById(R.id.call_decline_label)).getText());
    }

    private void setLabel(int viewId, String label, int fallback) {
        TextView view = findViewById(viewId);
        if (label == null || label.isEmpty()) view.setText(fallback);
        else view.setText(label);
    }

    private void answer() {
        CallNotifications.cancelRing(this, callId);
        Intent open = CallNotifications.answerIntent(this, callId, url);
        KeyguardManager keyguard = getSystemService(KeyguardManager.class);
        // The app itself never shows over the lock screen: the phone is unlocked first.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && keyguard != null && keyguard.isKeyguardLocked()) {
            keyguard.requestDismissKeyguard(this, new KeyguardManager.KeyguardDismissCallback() {
                @Override
                public void onDismissSucceeded() {
                    startActivity(open);
                    finishAndRemoveTask();
                }
            });
            return;
        }
        startActivity(open);
        finishAndRemoveTask();
    }

    private void decline() {
        sendBroadcast(CallNotifications.declineIntent(this, callId));
        finishAndRemoveTask();
    }
}
