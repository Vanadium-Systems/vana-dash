package systems.vanadium.dash;

import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.media.AudioDeviceCallback;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.util.Log;

import androidx.annotation.RequiresApi;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.lang.ref.WeakReference;

/**
 * Calls as on a phone: the ring while the app is open, the answer tapped on the notification or
 * the call screen, the foreground service and the audio route (earpiece, speaker, Bluetooth).
 *
 * Routes: "earpiece" (or a wired headset), "speaker", "headset" (Bluetooth on the call profile,
 * where Chromium puts it by itself) and "phone-mic" (Bluetooth stays on the music profile and the
 * phone's microphone records: no call profile, so the headphones keep their sound).
 */
@CapacitorPlugin(name = "NativeCall")
public class NativeCallPlugin extends Plugin {
    private static final String TAG = "VanaDashCall";
    private static WeakReference<NativeCallPlugin> instance = new WeakReference<>(null);

    private final Handler handler = new Handler(Looper.getMainLooper());
    private Ringtone ringtone;
    private PowerManager.WakeLock proximity;
    private String route;
    private AudioDeviceCallback deviceCallback;

    static void requestHangup() {
        NativeCallPlugin plugin = instance.get();
        if (plugin != null) plugin.notifyListeners("hangup", new JSObject());
    }

    @Override
    public void load() {
        super.load();
        instance = new WeakReference<>(this);
        collectAnswer(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        collectAnswer(intent);
    }

    @Override
    protected void handleOnDestroy() {
        stopRing();
        release();
        super.handleOnDestroy();
    }

    private void collectAnswer(Intent intent) {
        if (intent == null || !CallNotifications.ACTION_ANSWER.equals(intent.getAction())) return;
        String callId = intent.getStringExtra(CallNotifications.EXTRA_CALL_ID);
        String url = intent.getStringExtra(CallNotifications.EXTRA_URL);
        // Read once: a recreated activity gets the same intent again.
        intent.setAction(null);
        if (!CallNotifications.isCallId(callId)) return;
        CallNotifications.cancelRing(getContext(), callId);
        IncomingCallActivity.finishFor(callId);
        JSObject answer = new JSObject();
        answer.put("callId", callId);
        answer.put("url", url != null && url.startsWith("/") && !url.startsWith("//") ? url : "/calls/" + callId);
        // Retained: on a cold start the web app listens only after it has loaded.
        notifyListeners("answer", answer, true);
    }

    @PluginMethod
    public void startRinging(PluginCall call) {
        stopRing();
        Uri uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
        ringtone = RingtoneManager.getRingtone(getContext(), uri);
        if (ringtone != null) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) ringtone.setLooping(true);
            ringtone.play();
        }
        call.resolve();
    }

    @PluginMethod
    public void stopRinging(PluginCall call) {
        stopRing();
        call.resolve();
    }

    private void stopRing() {
        if (ringtone != null) ringtone.stop();
        ringtone = null;
    }

    @PluginMethod
    public void startCall(PluginCall call) {
        Context context = getContext();
        Intent service = new Intent(context, CallService.class)
            .putExtra(CallNotifications.EXTRA_TITLE, call.getString("title", ""))
            .putExtra(CallNotifications.EXTRA_BODY, call.getString("body", ""));
        try {
            ContextCompat.startForegroundService(context, service);
        } catch (RuntimeException e) {
            // No microphone permission yet, or started from the background: the call still works
            // while the app is on screen.
            Log.w(TAG, "call service not started: " + e.getMessage());
        }
        if (deviceCallback == null) {
            deviceCallback = new AudioDeviceCallback() {
                @Override
                public void onAudioDevicesAdded(AudioDeviceInfo[] added) {
                    onDevicesChanged();
                }

                @Override
                public void onAudioDevicesRemoved(AudioDeviceInfo[] removed) {
                    onDevicesChanged();
                }
            };
            audio().registerAudioDeviceCallback(deviceCallback, handler);
        }
        String requested = call.getString("route");
        route = requested != null ? requested : defaultRoute("video".equals(call.getString("kind")));
        apply();
        call.resolve(state());
    }

    @PluginMethod
    public void setRoute(PluginCall call) {
        String requested = call.getString("route");
        if (requested == null) {
            call.reject("route missing");
            return;
        }
        route = requested;
        apply();
        call.resolve(state());
    }

    @PluginMethod
    public void getState(PluginCall call) {
        call.resolve(state());
    }

    @PluginMethod
    public void endCall(PluginCall call) {
        release();
        call.resolve();
    }

    @PluginMethod
    public void fullScreenStatus(PluginCall call) {
        boolean allowed = true;
        if (Build.VERSION.SDK_INT >= 34) {
            allowed = getContext().getSystemService(NotificationManager.class).canUseFullScreenIntent();
        }
        JSObject result = new JSObject();
        result.put("allowed", allowed);
        call.resolve(result);
    }

    @PluginMethod
    public void openFullScreenSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 34) {
            Intent intent = new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:" + getContext().getPackageName()))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
        }
        call.resolve();
    }

    private void onDevicesChanged() {
        if (route == null) return;
        // A headset plugged in or out: Bluetooth "headset" falls back to the earpiece when it goes.
        if (("headset".equals(route) || "phone-mic".equals(route)) && !hasBluetooth()) route = "earpiece";
        // Chromium re-picks a device on the same change; ours goes in after it.
        handler.postDelayed(this::apply, 500);
        notifyListeners("audioState", state());
    }

    private String defaultRoute(boolean video) {
        if (hasBluetooth()) return "headset";
        return video ? "speaker" : "earpiece";
    }

    private void apply() {
        if (route == null) return;
        AudioManager audio = audio();
        if ("phone-mic".equals(route)) {
            audio.setMode(AudioManager.MODE_NORMAL);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) audio.clearCommunicationDevice();
            stopSco(audio);
            audio.setSpeakerphoneOn(false);
        } else {
            audio.setMode(AudioManager.MODE_IN_COMMUNICATION);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                selectCommunicationDevice(audio);
            } else {
                legacyRoute(audio);
            }
        }
        holdProximity("earpiece".equals(route));
    }

    @RequiresApi(Build.VERSION_CODES.S)
    private void selectCommunicationDevice(AudioManager audio) {
        int[] wanted;
        switch (route) {
            case "speaker":
                wanted = new int[] {AudioDeviceInfo.TYPE_BUILTIN_SPEAKER};
                break;
            case "headset":
                wanted = new int[] {AudioDeviceInfo.TYPE_BLUETOOTH_SCO, AudioDeviceInfo.TYPE_BLE_HEADSET};
                break;
            default:
                wanted = new int[] {AudioDeviceInfo.TYPE_WIRED_HEADSET, AudioDeviceInfo.TYPE_USB_HEADSET, AudioDeviceInfo.TYPE_BUILTIN_EARPIECE};
        }
        for (int type : wanted) {
            for (AudioDeviceInfo device : audio.getAvailableCommunicationDevices()) {
                if (device.getType() == type) {
                    audio.setCommunicationDevice(device);
                    return;
                }
            }
        }
    }

    @SuppressWarnings("deprecation")
    private void legacyRoute(AudioManager audio) {
        if ("headset".equals(route)) {
            audio.setSpeakerphoneOn(false);
            audio.startBluetoothSco();
            audio.setBluetoothScoOn(true);
            return;
        }
        stopSco(audio);
        audio.setSpeakerphoneOn("speaker".equals(route));
    }

    @SuppressWarnings("deprecation")
    private void stopSco(AudioManager audio) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            audio.stopBluetoothSco();
            audio.setBluetoothScoOn(false);
        }
    }

    private void holdProximity(boolean hold) {
        PowerManager power = getContext().getSystemService(PowerManager.class);
        if (hold && proximity == null && power.isWakeLockLevelSupported(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK)) {
            proximity = power.newWakeLock(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK, "vanadash:call");
            proximity.acquire(4 * 60 * 60 * 1000L);
        } else if (!hold && proximity != null) {
            if (proximity.isHeld()) proximity.release();
            proximity = null;
        }
    }

    private void release() {
        Context context = getContext();
        context.stopService(new Intent(context, CallService.class));
        holdProximity(false);
        if (deviceCallback != null) {
            audio().unregisterAudioDeviceCallback(deviceCallback);
        }
        deviceCallback = null;
        handler.removeCallbacksAndMessages(null);
        if (route != null) {
            AudioManager audio = audio();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) audio.clearCommunicationDevice();
            stopSco(audio);
            audio.setSpeakerphoneOn(false);
            audio.setMode(AudioManager.MODE_NORMAL);
        }
        route = null;
    }

    private boolean hasBluetooth() {
        for (AudioDeviceInfo device : audio().getDevices(AudioManager.GET_DEVICES_OUTPUTS)) {
            int type = device.getType();
            if (type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP || type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO) return true;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && type == AudioDeviceInfo.TYPE_BLE_HEADSET) return true;
        }
        return false;
    }

    private JSObject state() {
        JSObject result = new JSObject();
        result.put("route", route);
        result.put("bluetooth", hasBluetooth());
        return result;
    }

    private AudioManager audio() {
        return getContext().getSystemService(AudioManager.class);
    }
}
