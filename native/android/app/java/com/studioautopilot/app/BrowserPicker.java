package com.studioautopilot.app;

import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.Build;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Which browser shows the app. A Trusted Web Activity needs a browser that
 * offers it (Chrome, Edge, Samsung Internet, ...): the phone's default browser
 * if it can, else Chrome, else any that can. Without one the site opens in a
 * Custom Tab (a browser window with a slim bar), and failing that in any
 * browser at all -- never a dead end.
 *
 * The same order as android-browser-helper's TwaProviderPicker.
 */
final class BrowserPicker {
    static final String ACTION_CUSTOM_TABS_CONNECTION =
            "android.support.customtabs.action.CustomTabsService";
    static final String CATEGORY_TRUSTED_WEB_ACTIVITY =
            "androidx.browser.trusted.category.TrustedWebActivities";

    static final int TRUSTED_WEB_ACTIVITY = 0;
    static final int CUSTOM_TAB = 1;
    static final int BROWSER = 2;

    /** Tried in this order when the phone has no default browser that can run the app. */
    private static final String[] PREFERRED = {
        "com.android.chrome",
        "com.chrome.beta",
        "com.chrome.dev",
        "com.microsoft.emmx",
        "com.sec.android.app.sbrowser",
        "com.brave.browser",
    };

    static final class Choice {
        final int mode;
        final String packageName;

        Choice(int mode, String packageName) {
            this.mode = mode;
            this.packageName = packageName;
        }
    }

    private BrowserPicker() {}

    static Choice pick(PackageManager pm) {
        Intent browsers = new Intent(Intent.ACTION_VIEW)
                .addCategory(Intent.CATEGORY_BROWSABLE)
                .setData(Uri.fromParts("http", "", null));

        List<ResolveInfo> found = new ArrayList<>(pm.queryIntentActivities(browsers, PackageManager.MATCH_DEFAULT_ONLY));
        // MATCH_DEFAULT_ONLY gives exactly one entry when the person has chosen a default browser.
        boolean hasDefault = found.size() == 1;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            found.addAll(pm.queryIntentActivities(browsers, PackageManager.MATCH_ALL));
        }

        Map<String, Integer> services = customTabsServices(pm);

        if (hasDefault) {
            String first = found.get(0).activityInfo.packageName;
            Integer mode = services.get(first);
            if (mode != null && mode == TRUSTED_WEB_ACTIVITY) return new Choice(TRUSTED_WEB_ACTIVITY, first);
        }
        for (String name : PREFERRED) {
            Integer mode = services.get(name);
            if (mode != null && mode == TRUSTED_WEB_ACTIVITY) return new Choice(TRUSTED_WEB_ACTIVITY, name);
        }
        String customTab = null;
        String browser = null;
        for (ResolveInfo info : found) {
            String name = info.activityInfo.packageName;
            Integer mode = services.get(name);
            if (mode != null && mode == TRUSTED_WEB_ACTIVITY && isSystemOrStore(pm, name)) {
                return new Choice(TRUSTED_WEB_ACTIVITY, name);
            }
            if (mode != null && customTab == null) customTab = name;
            if (browser == null) browser = name;
        }
        if (customTab != null) return new Choice(CUSTOM_TAB, customTab);
        return new Choice(BROWSER, browser);
    }

    /** Package -> TRUSTED_WEB_ACTIVITY or CUSTOM_TAB, for every browser offering Custom Tabs. */
    private static Map<String, Integer> customTabsServices(PackageManager pm) {
        Map<String, Integer> out = new HashMap<>();
        Intent service = new Intent(ACTION_CUSTOM_TABS_CONNECTION);
        for (ResolveInfo info : pm.queryIntentServices(service, PackageManager.GET_RESOLVED_FILTER)) {
            if (info.serviceInfo == null) continue;
            String name = info.serviceInfo.packageName;
            boolean twa = info.filter != null && info.filter.hasCategory(CATEGORY_TRUSTED_WEB_ACTIVITY);
            if (twa || !out.containsKey(name)) out.put(name, twa ? TRUSTED_WEB_ACTIVITY : CUSTOM_TAB);
        }
        return out;
    }

    /** A browser that came with the phone or from the Play Store, not a sideloaded one. */
    @SuppressWarnings("deprecation")
    private static boolean isSystemOrStore(PackageManager pm, String name) {
        try {
            ApplicationInfo app = pm.getApplicationInfo(name, 0);
            if ((app.flags & ApplicationInfo.FLAG_SYSTEM) != 0) return true;
            return "com.android.vending".equals(pm.getInstallerPackageName(name));
        } catch (PackageManager.NameNotFoundException | IllegalArgumentException e) {
            return false;
        }
    }
}
