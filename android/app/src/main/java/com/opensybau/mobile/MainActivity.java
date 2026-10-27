package com.opensybau.mobile;

import android.annotation.SuppressLint;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import androidx.appcompat.app.AppCompatActivity;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.webkit.WebViewAssetLoader;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.Iterator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

public class MainActivity extends AppCompatActivity {
    private static final String APP_ENTRY_URL = "https://appassets.androidplatform.net/assets/public/index.html";
    private WebView webView;
    private String pendingPairingUri = null;
    private boolean pageReady = false;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        captureDeepLinkIntent(getIntent());

        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(Color.parseColor("#050507"));
        getWindow().setNavigationBarColor(Color.parseColor("#050507"));

        FrameLayout rootLayout = new FrameLayout(this);
        rootLayout.setBackgroundColor(Color.parseColor("#050507"));

        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#050507"));
        rootLayout.addView(
            webView,
            new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        );
        setContentView(rootLayout);

        WindowInsetsControllerCompat insetsController = WindowCompat.getInsetsController(getWindow(), rootLayout);
        if (insetsController != null) {
            insetsController.setAppearanceLightStatusBars(false);
            insetsController.setAppearanceLightNavigationBars(false);
        }

        ViewCompat.setOnApplyWindowInsetsListener(rootLayout, (v, windowInsets) -> {
            Insets insets = windowInsets.getInsets(
                WindowInsetsCompat.Type.systemBars()
                | WindowInsetsCompat.Type.displayCutout()
                | WindowInsetsCompat.Type.ime()
            );
            v.setPadding(insets.left, insets.top, insets.right, insets.bottom);
            return WindowInsetsCompat.CONSUMED;
        });

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setUserAgentString(settings.getUserAgentString() + " OpenSybauAndroid/0.3.3 Capacitor");

        webView.clearCache(true);
        WebView.setWebContentsDebuggingEnabled(true);
        webView.addJavascriptInterface(new OpenSybauNativeBridge(), "opensybauAndroid");

        final WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
            .build();

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (url != null && "appassets.androidplatform.net".equals(url.getHost())) {
                    String path = url.getPath();
                    if (path == null || path.isEmpty() || "/".equals(path)) {
                        path = "/assets/public/index.html";
                        url = url.buildUpon().path(path).build();
                    } else if (path.startsWith("/api/") || path.startsWith("/__events")) {
                        byte[] body = "{\"error\":\"Chưa kết nối máy chủ OpenSybau.\"}".getBytes(java.nio.charset.StandardCharsets.UTF_8);
                        return new WebResourceResponse(
                            "application/json",
                            "UTF-8",
                            503,
                            "Service Unavailable",
                            java.util.Collections.singletonMap("Cache-Control", "no-store"),
                            new java.io.ByteArrayInputStream(body)
                        );
                    } else if (!path.startsWith("/assets/public/")) {
                        url = url.buildUpon().path("/assets/public" + path).build();
                    }
                    WebResourceResponse response = assetLoader.shouldInterceptRequest(url);
                    if (response != null) {
                        response.setResponseHeaders(java.util.Collections.singletonMap("Cache-Control", "no-store"));
                        return response;
                    }
                }
                return super.shouldInterceptRequest(view, request);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (uri == null) return false;
                String scheme = uri.getScheme();
                if ("opensybau".equalsIgnoreCase(scheme)) {
                    pendingPairingUri = uri.toString();
                    dispatchPendingPairingUri();
                    return true;
                }
                if ("appassets.androidplatform.net".equalsIgnoreCase(uri.getHost())) {
                    return false;
                }
                Intent browserIntent = new Intent(Intent.ACTION_VIEW, uri);
                startActivity(browserIntent);
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                pageReady = true;
                dispatchPendingPairingUri();
            }
        });

        webView.setWebChromeClient(new WebChromeClient());
        webView.loadUrl(APP_ENTRY_URL);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        captureDeepLinkIntent(intent);
        dispatchPendingPairingUri();
    }

    private void captureDeepLinkIntent(Intent intent) {
        if (intent == null) return;
        Uri data = intent.getData();
        if (data != null && "opensybau".equalsIgnoreCase(data.getScheme())) {
            pendingPairingUri = data.toString();
        }
    }

    private void dispatchPendingPairingUri() {
        if (!pageReady || webView == null || pendingPairingUri == null || pendingPairingUri.isEmpty()) {
            return;
        }
        final String uri = pendingPairingUri;
        pendingPairingUri = null;
        final String escaped = JSONObject.quote(uri);
        webView.post(() -> webView.evaluateJavascript(
            "window.dispatchEvent(new CustomEvent('opensybau:pair', { detail: { uri: " + escaped + " } }));",
            null
        ));
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    public class OpenSybauNativeBridge {
        @JavascriptInterface
        public String getAppVersion() {
            return "0.3.3";
        }

        @JavascriptInterface
        public String getPlatformInfo() {
            try {
                JSONObject info = new JSONObject();
                info.put("platform", "android");
                info.put("sdkInt", Build.VERSION.SDK_INT);
                info.put("release", Build.VERSION.RELEASE);
                info.put("model", Build.MODEL);
                info.put("manufacturer", Build.MANUFACTURER);
                return info.toString();
            } catch (Exception e) {
                return "{\"platform\":\"android\"}";
            }
        }

        @JavascriptInterface
        public String getDeviceLanInfo() {
            try {
                String primaryIp = "";
                String primarySubnet = "";
                String tailscaleIp = "";
                JSONArray allIps = new JSONArray();
                Enumeration<NetworkInterface> interfaces = NetworkInterface.getNetworkInterfaces();
                if (interfaces != null) {
                    for (NetworkInterface nif : Collections.list(interfaces)) {
                        if (!nif.isUp() || nif.isLoopback()) continue;
                        String nifName = nif.getName() != null ? nif.getName().toLowerCase() : "";
                        for (InetAddress addr : Collections.list(nif.getInetAddresses())) {
                            if (!(addr instanceof Inet4Address) || addr.isLoopbackAddress()) continue;
                            String ip = addr.getHostAddress();
                            if (ip == null || ip.startsWith("169.254.")) continue;
                            allIps.put(ip);
                            if (ip.startsWith("100.")) {
                                if (tailscaleIp.isEmpty()) tailscaleIp = ip;
                                continue;
                            }
                            if (ip.startsWith("192.168.") || ip.startsWith("10.") || ip.matches("^172\\.(1[6-9]|2\\d|3[0-1])\\..*")) {
                                boolean isWifi = nifName.startsWith("wlan") || nifName.startsWith("eth") || nifName.startsWith("ap");
                                if (primaryIp.isEmpty() || isWifi) {
                                    primaryIp = ip;
                                    int lastDot = ip.lastIndexOf('.');
                                    if (lastDot > 0) primarySubnet = ip.substring(0, lastDot);
                                }
                            }
                        }
                    }
                }
                JSONObject res = new JSONObject();
                res.put("ip", primaryIp);
                res.put("subnet", primarySubnet);
                res.put("tailscaleIp", tailscaleIp);
                res.put("addresses", allIps);
                return res.toString();
            } catch (Exception e) {
                return "{\"ip\":\"\",\"subnet\":\"\",\"tailscaleIp\":\"\"}";
            }
        }

        @JavascriptInterface
        public String scanLanHosts(int targetPort) {
            final int portToScan = targetPort > 0 && targetPort <= 65535 ? targetPort : 4173;
            try {
                Set<String> subnets = new LinkedHashSet<>();
                String selfIp = "";
                JSONObject lanInfo = new JSONObject(getDeviceLanInfo());
                String detectedSubnet = lanInfo.optString("subnet", "");
                selfIp = lanInfo.optString("ip", "");
                if (!detectedSubnet.isEmpty()) {
                    subnets.add(detectedSubnet);
                }
                if (subnets.isEmpty()) {
                    subnets.add("192.168.1");
                    subnets.add("192.168.0");
                }
                final String finalSelfIp = selfIp;
                ExecutorService pool = Executors.newFixedThreadPool(36);
                List<Callable<JSONObject>> tasks = new ArrayList<>();
                for (final String subnet : subnets) {
                    for (int hostIdx = 1; hostIdx <= 254; hostIdx++) {
                        final String candidateIp = subnet + "." + hostIdx;
                        if (candidateIp.equals(finalSelfIp)) continue;
                        tasks.add(() -> {
                            HttpURLConnection conn = null;
                            try {
                                URL url = new URL("http://" + candidateIp + ":" + portToScan + "/api/ping");
                                conn = (HttpURLConnection) url.openConnection();
                                conn.setRequestMethod("GET");
                                conn.setConnectTimeout(420);
                                conn.setReadTimeout(600);
                                conn.setRequestProperty("Accept", "application/json");
                                conn.setRequestProperty("X-OpenSybau-Client", "android-apk");
                                int code = conn.getResponseCode();
                                if (code != 200 && code != 401) return null;
                                if (code == 401) {
                                    String wwwAuth = conn.getHeaderField("WWW-Authenticate");
                                    if (wwwAuth != null && wwwAuth.contains("OpenSybau")) {
                                        JSONObject item = new JSONObject();
                                        item.put("address", candidateIp);
                                        item.put("port", portToScan);
                                        item.put("url", "http://" + candidateIp + ":" + portToScan);
                                        item.put("hostname", candidateIp);
                                        item.put("name", "PC (" + candidateIp + ")");
                                        item.put("authRequired", true);
                                        return item;
                                    }
                                    return null;
                                }
                                InputStream in = conn.getInputStream();
                                BufferedReader reader = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8));
                                StringBuilder sb = new StringBuilder();
                                String line;
                                while ((line = reader.readLine()) != null) {
                                    sb.append(line);
                                }
                                reader.close();
                                JSONObject payload = new JSONObject(sb.toString());
                                if (!"OpenSybau".equalsIgnoreCase(payload.optString("app", ""))) return null;
                                String hostName = payload.optString("hostname", candidateIp);
                                JSONObject item = new JSONObject();
                                item.put("address", candidateIp);
                                item.put("port", payload.optInt("port", portToScan));
                                item.put("url", "http://" + candidateIp + ":" + portToScan);
                                item.put("hostname", hostName);
                                item.put("name", hostName.isEmpty() ? ("PC (" + candidateIp + ")") : hostName);
                                item.put("platform", payload.optString("platform", ""));
                                item.put("authRequired", payload.optBoolean("authRequired", true));
                                return item;
                            } catch (Exception ignored) {
                                return null;
                            } finally {
                                if (conn != null) conn.disconnect();
                            }
                        });
                    }
                }
                List<Future<JSONObject>> futures = pool.invokeAll(tasks, 4500, TimeUnit.MILLISECONDS);
                pool.shutdownNow();
                JSONArray found = new JSONArray();
                for (Future<JSONObject> fut : futures) {
                    if (fut.isDone() && !fut.isCancelled()) {
                        try {
                            JSONObject item = fut.get();
                            if (item != null) found.put(item);
                        } catch (Exception ignored) {}
                    }
                }
                return found.toString();
            } catch (Exception e) {
                return "[]";
            }
        }

        @JavascriptInterface
        public String httpRequest(String method, String urlString, String headersJson, String body) {
            HttpURLConnection conn = null;
            try {
                URL url = new URL(urlString);
                conn = (HttpURLConnection) url.openConnection();
                String cleanMethod = (method == null || method.isEmpty()) ? "GET" : method.toUpperCase();
                conn.setRequestMethod(cleanMethod);
                conn.setConnectTimeout(7000);
                conn.setReadTimeout(20000);
                conn.setUseCaches(false);
                conn.setRequestProperty("X-OpenSybau-Client", "android-apk");
                if (headersJson != null && !headersJson.isEmpty()) {
                    JSONObject headersObj = new JSONObject(headersJson);
                    Iterator<String> keys = headersObj.keys();
                    while (keys.hasNext()) {
                        String key = keys.next();
                        String val = headersObj.optString(key, "");
                        if (key != null && !key.isEmpty() && val != null) {
                            conn.setRequestProperty(key, val);
                        }
                    }
                }
                if (body != null && !body.isEmpty() && ("POST".equals(cleanMethod) || "PUT".equals(cleanMethod) || "PATCH".equals(cleanMethod) || "DELETE".equals(cleanMethod))) {
                    conn.setDoOutput(true);
                    byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                    conn.setFixedLengthStreamingMode(bytes.length);
                    OutputStream os = conn.getOutputStream();
                    os.write(bytes);
                    os.flush();
                    os.close();
                }
                int status = conn.getResponseCode();
                InputStream stream = (status >= 200 && status < 400) ? conn.getInputStream() : conn.getErrorStream();
                String responseBody = "";
                if (stream != null) {
                    BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8));
                    StringBuilder sb = new StringBuilder();
                    String line;
                    while ((line = reader.readLine()) != null) {
                        if (sb.length() > 0) sb.append('\n');
                        sb.append(line);
                    }
                    reader.close();
                    responseBody = sb.toString();
                }
                JSONObject res = new JSONObject();
                res.put("ok", status >= 200 && status < 300);
                res.put("status", status);
                res.put("etag", conn.getHeaderField("ETag") != null ? conn.getHeaderField("ETag") : "");
                res.put("contentType", conn.getHeaderField("Content-Type") != null ? conn.getHeaderField("Content-Type") : "application/json");
                res.put("body", responseBody);
                return res.toString();
            } catch (Exception e) {
                try {
                    JSONObject err = new JSONObject();
                    err.put("ok", false);
                    err.put("status", 0);
                    err.put("error", e.getMessage() != null ? e.getMessage() : "Network error");
                    return err.toString();
                } catch (Exception ignored) {
                    return "{\"ok\":false,\"status\":0,\"error\":\"Network error\"}";
                }
            } finally {
                if (conn != null) conn.disconnect();
            }
        }
    }
}
