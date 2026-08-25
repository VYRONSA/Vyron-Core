package za.co.vyronsoft.core;

import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.os.Bundle;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

/**
 * The native shell, and the one job it does beyond hosting the WebView:
 * getting an employee back into the app after they start it with no signal.
 *
 * WHY THIS CANNOT BE LEFT TO THE OFFLINE PAGE
 *
 *   When the app launches without a connection, Capacitor shows the bundled
 *   `errorPath` document. That page is served from the app bundle, so it runs
 *   on a different origin from the server the app lives on, and a navigation
 *   back to the app is a cross-origin one that Capacitor's navigation policy
 *   refuses — it hands the URL to the system browser instead. The employee is
 *   dropped into Chrome, away from the reports queued on their device, and the
 *   app itself is left showing a page it can never leave.
 *
 *   Loading the URL from here is not subject to that policy: this is the host
 *   telling its own WebView what to display, not a page asking to navigate. So
 *   the shell watches for a usable network and reloads the app itself. The
 *   driver does not have to know to press anything, and never leaves the app.
 */
public class MainActivity extends BridgeActivity {

  private ConnectivityManager connectivity;
  private ConnectivityManager.NetworkCallback watcher;

  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    watchForConnectivity();
  }

  private void watchForConnectivity() {
    connectivity = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
    if (connectivity == null) return;

    watcher =
        new ConnectivityManager.NetworkCallback() {
          @Override
          public void onAvailable(Network network) {
            runOnUiThread(MainActivity.this::reopenAppIfStranded);
          }
        };

    try {
      connectivity.registerNetworkCallback(
          new NetworkRequest.Builder()
              .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
              .build(),
          watcher);
    } catch (RuntimeException ignored) {
      // Some devices refuse to register while the screen is off. Recovery is a
      // convenience, never a correctness guarantee — the queue is already
      // durable — so failing to watch must not stop the app from starting.
      watcher = null;
    }
  }

  /**
   * Reload the app, but only from the offline page.
   *
   * Anywhere else this would be destructive: reloading mid-form would throw
   * away what the employee is typing, and connectivity callbacks fire whenever
   * a network changes, not only after an outage.
   */
  private void reopenAppIfStranded() {
    if (getBridge() == null) return;
    WebView webView = getBridge().getWebView();
    if (webView == null) return;

    String current = webView.getUrl();
    if (current == null || !current.contains("offline.html")) return;

    // The CONFIGURED url, which keeps its path. getServerUrl() reports the
    // origin only, and reloading that drops the employee on the public
    // marketing site instead of back into their work.
    String appUrl = getBridge().getConfig().getServerUrl();
    if (appUrl == null || appUrl.isEmpty()) appUrl = getBridge().getServerUrl();
    if (appUrl != null && !appUrl.isEmpty()) webView.loadUrl(appUrl);
  }

  /**
   * Reopening the app is the other moment a connection has usually returned.
   *
   * The network callback only fires on a transition, so an employee who walked
   * back into coverage while the app was in the background would otherwise sit
   * on the offline page until something else changed.
   */
  @Override
  public void onResume() {
    super.onResume();
    reopenAppIfStranded();
  }

  @Override
  public void onDestroy() {
    if (connectivity != null && watcher != null) {
      try {
        connectivity.unregisterNetworkCallback(watcher);
      } catch (RuntimeException ignored) {
        // Already gone; nothing to release.
      }
    }
    super.onDestroy();
  }
}
