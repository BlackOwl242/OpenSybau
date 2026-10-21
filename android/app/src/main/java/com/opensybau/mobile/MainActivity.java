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

import androidx.appcompat.app.AppCompatActivity;
import androidx.webkit.WebViewAssetLoader;

import org.json.JSONObject;

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

        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#0c0c0f"));
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setUserAgentString(settings.getUserAgentString() + " OpenSybauAndroid/0.2.102 Capacitor");

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
                    if (path != null && !path.startsWith("/assets/")) {
                        url = url.buildUpon().path("/assets/public" + path).build();
                    }
                    WebResourceResponse response = assetLoader.shouldInterceptRequest(url);
                    if (response != null) {
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
            return "0.2.102";
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
    }
}
