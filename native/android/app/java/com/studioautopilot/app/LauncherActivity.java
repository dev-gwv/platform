package com.studioautopilot.app;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.ActivityNotFoundException;
import android.content.ComponentName;
import android.content.Intent;
import android.content.ServiceConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.RemoteException;
import android.support.customtabs.ICustomTabsCallback;
import android.support.customtabs.ICustomTabsService;
import android.widget.Toast;

/**
 * Studio AutoPilot for Android.
 *
 * The app is the live site (https://studioautopilot.in) running full screen in
 * Chrome as a Trusted Web Activity: no address bar, the app's own icon and
 * name, and Chrome underneath -- so Facebook and Google sign-in, the camera,
 * the microphone, location for attendance, downloads, WhatsApp and phone links
 * all work exactly as they do in Chrome, and every change to the site is in
 * the app the next time it opens. Chrome hides the address bar only once
 * https://studioautopilot.in/.well-known/assetlinks.json names this app and
 * the key it is signed with.
 *
 * This activity shows the splash, asks the browser for a session over the
 * Custom Tabs service (the same calls androidx.browser makes), opens the site
 * and stays underneath it; pressing Back out of the site closes the app.
 */
public class LauncherActivity extends Activity {
    static final String SITE_HOST = "studioautopilot.in";
    static final String START_URL = "https://" + SITE_HOST + "/dashboard";

    // androidx.browser's extras, by value (CustomTabsIntent, TrustedWebActivityIntentBuilder).
    private static final String EXTRA_SESSION = "android.support.customtabs.extra.SESSION";
    private static final String EXTRA_SESSION_ID = "android.support.customtabs.extra.SESSION_ID";
    private static final String EXTRA_LAUNCH_AS_TRUSTED_WEB_ACTIVITY =
            "android.support.customtabs.extra.LAUNCH_AS_TRUSTED_WEB_ACTIVITY";
    private static final String EXTRA_TOOLBAR_COLOR = "android.support.customtabs.extra.TOOLBAR_COLOR";
    private static final String EXTRA_NAVIGATION_BAR_COLOR =
            "androidx.browser.customtabs.extra.NAVIGATION_BAR_COLOR";
    private static final String EXTRA_ENABLE_INSTANT_APPS =
            "android.support.customtabs.extra.EXTRA_ENABLE_INSTANT_APPS";
    private static final String EXTRA_DISPLAY_MODE = "androidx.browser.trusted.extra.DISPLAY_MODE";
    private static final String KEY_DISPLAY_MODE_ID = "androidx.browser.trusted.displaymode.KEY_ID";
    private static final String EXTRA_SCREEN_ORIENTATION = "androidx.browser.trusted.extra.SCREEN_ORIENTATION";

    /** The brand's navy (the site's theme colour) behind the status bar; white under the page. */
    private static final int STATUS_BAR_COLOR = 0xFF1B2A4A;
    private static final int NAVIGATION_BAR_COLOR = 0xFFFFFFFF;

    private static final String STATE_LAUNCHED = "browser_launched";
    /** Chrome answers in well under a second; past this the site opens in a plain tab instead. */
    private static final long SESSION_TIMEOUT_MS = 6000;

    /** How many of these are alive: more than one means the app is already open underneath. */
    private static int sAlive = 0;

    private final Handler mHandler = new Handler(Looper.getMainLooper());
    private ServiceConnection mConnection;
    private ICustomTabsCallback.Stub mCallback;
    private boolean mLaunched;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        sAlive++;

        Uri link = getIntent().getData();
        if (sAlive > 1 && link == null) {
            // Tapping the icon while the app is open: Android has already brought it forward.
            finish();
            return;
        }
        if (restartInNewTask()) {
            finish();
            return;
        }
        if (savedInstanceState != null && savedInstanceState.getBoolean(STATE_LAUNCHED)) {
            // Android closed this screen while the site was open, and the person has now left the site.
            finish();
            return;
        }

        final Uri target = targetFor(link);
        BrowserPicker.Choice choice = BrowserPicker.pick(getPackageManager());
        if (choice.packageName == null) {
            Toast.makeText(this, R.string.no_browser, Toast.LENGTH_LONG).show();
            finish();
            return;
        }
        if (choice.mode == BrowserPicker.TRUSTED_WEB_ACTIVITY) {
            launchTrusted(choice.packageName, target);
        } else {
            launchPlain(choice.packageName, target, choice.mode == BrowserPicker.CUSTOM_TAB);
        }
    }

    /** A studioautopilot.in link (from WhatsApp, an email) opens that page; anything else opens Home. */
    static Uri targetFor(Uri link) {
        if (link != null && "https".equals(link.getScheme()) && SITE_HOST.equals(link.getHost())) return link;
        return Uri.parse(START_URL);
    }

    private void launchTrusted(final String browser, final Uri target) {
        mCallback = new SessionCallback();
        mConnection = new ServiceConnection() {
            @Override
            public void onServiceConnected(ComponentName name, IBinder binder) {
                if (mLaunched || isFinishing()) return;
                ICustomTabsService service = ICustomTabsService.Stub.asInterface(binder);
                try {
                    service.warmup(0);
                    PendingIntent sessionId = sessionId();
                    Bundle extras = new Bundle();
                    extras.putParcelable(EXTRA_SESSION_ID, sessionId);
                    boolean ok;
                    try {
                        ok = service.newSessionWithExtras(mCallback, extras);
                    } catch (RemoteException | RuntimeException e) {
                        ok = false;
                    }
                    if (!ok) {
                        // A browser from before session ids.
                        sessionId = null;
                        ok = service.newSession(mCallback);
                    }
                    if (!ok) {
                        launchPlain(browser, target, true);
                        return;
                    }
                    startBrowser(trustedIntent(browser, target, sessionId));
                } catch (RemoteException | RuntimeException e) {
                    launchPlain(browser, target, true);
                }
            }

            @Override
            public void onServiceDisconnected(ComponentName name) {
                // The browser restarted; the open site keeps running in it.
            }
        };

        Intent service = new Intent(BrowserPicker.ACTION_CUSTOM_TABS_CONNECTION).setPackage(browser);
        boolean bound;
        try {
            bound = bindService(service, mConnection, BIND_AUTO_CREATE);
        } catch (SecurityException e) {
            bound = false;
        }
        if (!bound) {
            mConnection = null;
            launchPlain(browser, target, true);
            return;
        }
        mHandler.postDelayed(new Runnable() {
            @Override
            public void run() {
                if (!mLaunched && !isFinishing()) launchPlain(browser, target, true);
            }
        }, SESSION_TIMEOUT_MS);
    }

    /** Identifies this app's session to the browser across launches in the same task. */
    private PendingIntent sessionId() {
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0;
        return PendingIntent.getActivity(this, getTaskId(), new Intent(), flags);
    }

    private Intent trustedIntent(String browser, Uri target, PendingIntent sessionId) {
        Intent intent = new Intent(Intent.ACTION_VIEW, target);
        intent.setPackage(browser);
        Bundle session = new Bundle();
        session.putBinder(EXTRA_SESSION, mCallback.asBinder());
        if (sessionId != null) session.putParcelable(EXTRA_SESSION_ID, sessionId);
        intent.putExtras(session);
        intent.putExtra(EXTRA_LAUNCH_AS_TRUSTED_WEB_ACTIVITY, true);
        intent.putExtra(EXTRA_ENABLE_INSTANT_APPS, false);
        intent.putExtra(EXTRA_TOOLBAR_COLOR, STATUS_BAR_COLOR);
        intent.putExtra(EXTRA_NAVIGATION_BAR_COLOR, NAVIGATION_BAR_COLOR);
        Bundle display = new Bundle();
        display.putInt(KEY_DISPLAY_MODE_ID, 0); // standalone: the system bars stay
        intent.putExtra(EXTRA_DISPLAY_MODE, display);
        intent.putExtra(EXTRA_SCREEN_ORIENTATION, 0); // the phone's own rotation
        return intent;
    }

    /**
     * No browser here can run the app full screen (or it did not answer): open the
     * site in a Custom Tab, or in the browser itself. Everything still works; a slim
     * bar shows the address.
     */
    private void launchPlain(String browser, Uri target, boolean customTab) {
        if (mLaunched) return;
        Intent intent = new Intent(Intent.ACTION_VIEW, target);
        if (browser != null) intent.setPackage(browser);
        if (customTab) {
            Bundle session = new Bundle();
            session.putBinder(EXTRA_SESSION, null);
            intent.putExtras(session);
            intent.putExtra(EXTRA_TOOLBAR_COLOR, STATUS_BAR_COLOR);
        }
        try {
            startBrowser(intent);
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, R.string.no_browser, Toast.LENGTH_LONG).show();
            finish();
        }
    }

    private void startBrowser(Intent intent) {
        if (mLaunched) return;
        mLaunched = true;
        mHandler.removeCallbacksAndMessages(null);
        startActivity(intent);
    }

    /**
     * Only one copy of the app in Recents: a link opened from another app starts
     * a new task, the way android-browser-helper's LauncherActivity does it.
     */
    private boolean restartInNewTask() {
        int flags = getIntent().getFlags();
        boolean newTask = (flags & Intent.FLAG_ACTIVITY_NEW_TASK) != 0;
        boolean newDocument = (flags & Intent.FLAG_ACTIVITY_NEW_DOCUMENT) != 0;
        if (newTask && !newDocument) return false;
        Intent again = new Intent(getIntent());
        again.setFlags((flags | Intent.FLAG_ACTIVITY_NEW_TASK) & ~Intent.FLAG_ACTIVITY_NEW_DOCUMENT);
        startActivity(again);
        return true;
    }

    @Override
    protected void onRestart() {
        super.onRestart();
        // The person pressed Back out of the site and landed here: close the app.
        if (mLaunched) finish();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        outState.putBoolean(STATE_LAUNCHED, mLaunched);
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        sAlive--;
        mHandler.removeCallbacksAndMessages(null);
        if (mConnection != null) {
            try {
                unbindService(mConnection);
            } catch (IllegalArgumentException e) {
                // Already unbound.
            }
            mConnection = null;
        }
    }

    /** The browser reports page events here; the app needs none of them. */
    private static final class SessionCallback extends ICustomTabsCallback.Stub {
        @Override public void onNavigationEvent(int navigationEvent, Bundle extras) {}
        @Override public void extraCallback(String callbackName, Bundle args) {}
        @Override public void onMessageChannelReady(Bundle extras) {}
        @Override public void onPostMessage(String message, Bundle extras) {}
        @Override public void onRelationshipValidationResult(int relation, Uri origin, boolean result, Bundle extras) {}
        @Override public Bundle extraCallbackWithResult(String callbackName, Bundle args) { return null; }
        @Override public void onActivityResized(int height, int width, Bundle extras) {}
        @Override public void onWarmupCompleted(Bundle extras) {}
        @Override public void onActivityLayout(int left, int top, int right, int bottom, int state, Bundle extras) {}
        @Override public void onMinimized(Bundle extras) {}
        @Override public void onUnminimized(Bundle extras) {}
    }
}
