package com.bardompro.zai;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;

/**
 * BardomPro AI v3.0.1 — MainActivity (No-Settings + Storage Permissions Edition)
 *
 * Improvements in v3.0.1:
 *  - Runtime permission requests: storage (READ_MEDIA_*, READ/WRITE_EXTERNAL_STORAGE),
 *    camera, microphone (for ASR), notifications
 *  - WebChromeClient with onShowFileChooser — enables file uploads from device storage
 *  - WebView DownloadListener — handles <a download> for saving generated images
 *  - Better network settings: universal access from file URLs, mixed content always allowed
 *  - Permission-aware bridge for native permission checks from JS
 *
 * Uses only Android framework APIs (no AndroidX dependencies) for maximum compatibility.
 *
 * Architecture:
 *  1. The APK embeds the web-app in assets/web/ (offline-capable shell)
 *  2. On launch, the WebView loads file:///android_asset/web/index.html
 *  3. The web app auto-discovers backend with fallback list
 *  4. Storage permissions enable saving generated images to /sdcard/BardomPro/
 */
public class MainActivity extends Activity {

    private static final String DEFAULT_BACKEND_URL = "https://bardompro-v3.onrender.com";
    private static final String USER_ID = "ef2ad49b-23e9-4c2d-8b13-6ff693f5dd90";
    private static final String APP_VERSION = "3.0.1";
    private static final String ASSET_BASE = "file:///android_asset/web/";

    private static final int REQ_PERMS = 1001;
    private static final int REQ_FILE_CHOOSER = 1002;

    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        if (!isOnline()) {
            Toast.makeText(this, R.string.error_no_internet, Toast.LENGTH_LONG).show();
            finish();
            return;
        }

        webView = new WebView(this);
        webView.setBackgroundColor(0xFF070B18);
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowUniversalAccessFromFileURLs(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        s.setUserAgentString("BardomPro-AI/" + APP_VERSION + " (Android; user=" + USER_ID + ")");
        s.setSupportZoom(false);
        s.setDisplayZoomControls(false);
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);

        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new BardomChromeClient());
        webView.setDownloadListener(new BardomDownloadListener());
        webView.addJavascriptInterface(new BardomBridge(), "AndroidBridge");
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        setContentView(webView);

        // Request runtime permissions before loading content
        requestRuntimePermissions();

        // Boot directly from local assets — no network needed for the shell
        webView.loadUrl(ASSET_BASE + "index.html");
    }

    /**
     * Build the list of runtime permissions we need based on Android version.
     */
    private String[] getRequiredPermissions() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            return new String[]{};
        }
        List<String> perms = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            // Android 13+ (API 33+)
            perms.add(android.Manifest.permission.READ_MEDIA_IMAGES);
            perms.add(android.Manifest.permission.READ_MEDIA_VIDEO);
            perms.add(android.Manifest.permission.READ_MEDIA_AUDIO);
            perms.add(android.Manifest.permission.POST_NOTIFICATIONS);
        } else {
            // Android 6-12
            perms.add(android.Manifest.permission.READ_EXTERNAL_STORAGE);
            if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.Q) {
                perms.add(android.Manifest.permission.WRITE_EXTERNAL_STORAGE);
            }
        }
        perms.add(android.Manifest.permission.CAMERA);
        perms.add(android.Manifest.permission.RECORD_AUDIO);
        return perms.toArray(new String[0]);
    }

    private void requestRuntimePermissions() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return;
        List<String> toRequest = new ArrayList<>();
        for (String perm : getRequiredPermissions()) {
            if (checkSelfPermission(perm) != PackageManager.PERMISSION_GRANTED) {
                toRequest.add(perm);
            }
        }
        if (!toRequest.isEmpty()) {
            requestPermissions(toRequest.toArray(new String[0]), REQ_PERMS);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_PERMS) {
            int granted = 0;
            for (int r : grantResults) if (r == PackageManager.PERMISSION_GRANTED) granted++;
            Toast.makeText(this, "تم منح " + granted + "/" + permissions.length + " صلاحية", Toast.LENGTH_SHORT).show();
        }
    }

    private boolean isOnline() {
        ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        Network net = cm.getActiveNetwork();
        if (net == null) return false;
        NetworkCapabilities caps = cm.getNetworkCapabilities(net);
        return caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
    }

    /** Chrome client with file chooser + permission handling */
    private class BardomChromeClient extends WebChromeClient {
        @Override
        public void onPermissionRequest(final PermissionRequest request) {
            // Auto-grant resources requested by web APIs (camera, mic, etc.)
            runOnUiThread(new Runnable() {
                @Override public void run() {
                    request.grant(request.getResources());
                }
            });
        }

        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            // Cancel any previous callback
            if (filePathCallback != null) {
                filePathCallback.onReceiveValue(null);
            }
            filePathCallback = callback;

            try {
                Intent intent = params.createIntent();
                startActivityForResult(intent, REQ_FILE_CHOOSER);
            } catch (Exception e) {
                filePathCallback = null;
                Toast.makeText(MainActivity.this, "تعذّر فتح منتقي الملفات", Toast.LENGTH_SHORT).show();
                return false;
            }
            return true;
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE_CHOOSER && filePathCallback != null) {
            Uri[] results = null;
            if (resultCode == RESULT_OK && data != null) {
                String dataString = data.getDataString();
                if (dataString != null) {
                    results = new Uri[]{ Uri.parse(dataString) };
                } else if (data.getClipData() != null) {
                    int count = data.getClipData().getItemCount();
                    results = new Uri[count];
                    for (int i = 0; i < count; i++) {
                        results[i] = data.getClipData().getItemAt(i).getUri();
                    }
                }
            }
            filePathCallback.onReceiveValue(results);
            filePathCallback = null;
        } else {
            super.onActivityResult(requestCode, resultCode, data);
        }
    }

    /** Download listener — saves files to /sdcard/Download/BardomPro/ */
    private class BardomDownloadListener implements android.webkit.DownloadListener {
        @Override
        public void onDownloadStart(final String url, String userAgent, String contentDisposition, String mimetype, long contentLength) {
            try {
                // Determine filename
                String filename = "bardompro_" + System.currentTimeMillis();
                if (contentDisposition != null && contentDisposition.contains("filename=")) {
                    int idx = contentDisposition.indexOf("filename=");
                    if (idx >= 0) {
                        filename = contentDisposition.substring(idx + 9).replace("\"", "").replace(";", "").trim();
                    }
                }
                if (filename.indexOf('.') < 0) {
                    filename += mimetype != null && mimetype.contains("png") ? ".png" : ".bin";
                }

                // Choose destination
                File dir;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    // Use app-specific external dir on Android 10+ (no permission needed)
                    dir = new File(getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "BardomPro");
                } else {
                    dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "BardomPro");
                }
                if (dir == null) {
                    Toast.makeText(MainActivity.this, "تعذّر إنشاء مجلد التنزيل", Toast.LENGTH_SHORT).show();
                    return;
                }
                if (!dir.exists()) dir.mkdirs();
                final File outFile = new File(dir, filename);

                // Download in background thread
                final String finalUrl = url;
                new Thread(new Runnable() {
                    @Override public void run() {
                        InputStream in = null;
                        FileOutputStream out = null;
                        try {
                            URL u = new URL(finalUrl);
                            in = u.openStream();
                            out = new FileOutputStream(outFile);
                            byte[] buf = new byte[8192];
                            int n;
                            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                            final String savedName = outFile.getName();
                            runOnUiThread(new Runnable() {
                                @Override public void run() {
                                    Toast.makeText(MainActivity.this,
                                        "تم حفظ الملف: " + savedName,
                                        Toast.LENGTH_LONG).show();
                                }
                            });
                        } catch (final Exception e) {
                            runOnUiThread(new Runnable() {
                                @Override public void run() {
                                    Toast.makeText(MainActivity.this,
                                        "فشل التنزيل: " + e.getMessage(),
                                        Toast.LENGTH_SHORT).show();
                                }
                            });
                        } finally {
                            try { if (in != null) in.close(); } catch (Exception ignored) {}
                            try { if (out != null) out.close(); } catch (Exception ignored) {}
                        }
                    }
                }).start();
            } catch (Exception e) {
                Toast.makeText(MainActivity.this, "خطأ في التنزيل: " + e.getMessage(), Toast.LENGTH_SHORT).show();
            }
        }
    }

    /** JS bridge — exposes config + permission checking (no settings UI) */
    public class BardomBridge {
        @JavascriptInterface
        public String getConfig() {
            return "{\"backendUrl\":\"" + DEFAULT_BACKEND_URL + "\","
                 + "\"userId\":\"" + USER_ID + "\","
                 + "\"version\":\"" + APP_VERSION + "\","
                 + "\"platform\":\"android\"}";
        }

        @JavascriptInterface
        public String getUserId() { return USER_ID; }

        @JavascriptInterface
        public String getBackendUrl() { return DEFAULT_BACKEND_URL; }

        @JavascriptInterface
        public String getVersion() { return APP_VERSION; }

        @JavascriptInterface
        public boolean hasStoragePermission() {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                return checkSelfPermission(android.Manifest.permission.READ_MEDIA_IMAGES) == PackageManager.PERMISSION_GRANTED;
            }
            return checkSelfPermission(android.Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED;
        }

        @JavascriptInterface
        public void requestStoragePermission() {
            runOnUiThread(new Runnable() {
                @Override public void run() {
                    requestRuntimePermissions();
                }
            });
        }

        @JavascriptInterface
        public void toast(final String message) {
            runOnUiThread(new Runnable() {
                @Override public void run() {
                    Toast.makeText(MainActivity.this, message, Toast.LENGTH_SHORT).show();
                }
            });
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onDestroy() {
        webView.removeJavascriptInterface("AndroidBridge");
        webView.loadUrl("about:blank");
        webView.destroy();
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }
}
