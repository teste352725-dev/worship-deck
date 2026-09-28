package br.com.worshipdeck.mobile;

import android.annotation.SuppressLint;
import android.app.AlertDialog;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.wifi.WifiManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

public class MainActivity extends AppCompatActivity {
    private static final String PREFS = "worship_deck_mobile";
    private static final String KEY_LOCAL = "local_url";
    private static final String KEY_REMOTE = "remote_url";
    private static final int DISCOVERY_PORT = 4179;
    private static final int[] DECK_PORTS = {4177, 4277};

    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService background = Executors.newCachedThreadPool();
    private SharedPreferences prefs;
    private FrameLayout root;
    private WebView webView;
    private LinearLayout setup;
    private TextView status;
    private EditText manualAddress;
    private ProgressBar progress;
    private final AtomicBoolean searching = new AtomicBoolean(false);
    private long backPressedAt = 0;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        buildScreen();
        configureWebView();
        discover(true);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private TextView text(String value, int size, int color) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(color);
        return view;
    }

    private Button button(String value) {
        Button b = new Button(this);
        b.setText(value);
        b.setAllCaps(false);
        b.setTextColor(Color.WHITE);
        b.setBackgroundColor(Color.rgb(25, 51, 86));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52));
        lp.setMargins(0, dp(7), 0, dp(7));
        b.setLayoutParams(lp);
        return b;
    }

    private EditText input(String hint) {
        EditText e = new EditText(this);
        e.setHint(hint);
        e.setSingleLine(true);
        e.setTextColor(Color.WHITE);
        e.setHintTextColor(Color.rgb(130, 142, 160));
        e.setBackgroundColor(Color.rgb(22, 28, 38));
        e.setPadding(dp(14), 0, dp(14), 0);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52));
        lp.setMargins(0, dp(12), 0, dp(6));
        e.setLayoutParams(lp);
        return e;
    }

    private void buildScreen() {
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(9, 11, 16));

        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(9, 11, 16));
        webView.setVisibility(View.GONE);
        root.addView(webView, new FrameLayout.LayoutParams(-1, -1));

        setup = new LinearLayout(this);
        setup.setOrientation(LinearLayout.VERTICAL);
        setup.setGravity(Gravity.CENTER_HORIZONTAL);
        setup.setPadding(dp(26), dp(34), dp(26), dp(24));

        TextView mark = text("W", 34, Color.rgb(130, 183, 255));
        mark.setGravity(Gravity.CENTER);
        setup.addView(mark, new LinearLayout.LayoutParams(dp(66), dp(66)));

        TextView title = text("Worship Deck", 25, Color.WHITE);
        title.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams titleLp = new LinearLayout.LayoutParams(-1, -2);
        titleLp.setMargins(0, dp(10), 0, dp(5));
        setup.addView(title, titleLp);

        TextView caption = text("CONTROLE DO CULTO", 11, Color.rgb(117, 224, 167));
        caption.setGravity(Gravity.CENTER);
        setup.addView(caption, new LinearLayout.LayoutParams(-1, -2));

        progress = new ProgressBar(this);
        LinearLayout.LayoutParams progressLp = new LinearLayout.LayoutParams(dp(38), dp(38));
        progressLp.setMargins(0, dp(28), 0, dp(12));
        setup.addView(progress, progressLp);

        status = text("Procurando o Deck na rede…", 15, Color.rgb(190, 198, 211));
        status.setGravity(Gravity.CENTER);
        setup.addView(status, new LinearLayout.LayoutParams(-1, -2));

        manualAddress = input("Endereço do PC, ex.: 192.168.0.115:4177");
        setup.addView(manualAddress);

        Button connect = button("Conectar ao endereço informado");
        connect.setOnClickListener(v -> connectManual());
        setup.addView(connect);

        Button retry = button("Procurar novamente na rede");
        retry.setOnClickListener(v -> discover(false));
        setup.addView(retry);

        Button remote = button("Configurar acesso remoto");
        remote.setOnClickListener(v -> showRemoteDialog());
        setup.addView(remote);

        FrameLayout.LayoutParams setupLp = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER);
        root.addView(setup, setupLp);
        setContentView(root);
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configureWebView() {
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        s.setLoadWithOverviewMode(false);
        s.setUseWideViewPort(true);
        s.setSupportZoom(false);
        s.setUserAgentString(s.getUserAgentString() + " WorshipDeckAndroid/1.0");
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);
        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                prefs.edit().putString(KEY_LOCAL, origin(url)).apply();
                setup.setVisibility(View.GONE);
                webView.setVisibility(View.VISIBLE);
                progress.setVisibility(View.GONE);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showSetup("Não foi possível abrir o Deck. Confira o Wi-Fi ou procure novamente.");
            }
        });
    }

    private String normalize(String raw) {
        String value = raw == null ? "" : raw.trim();
        if (value.isEmpty()) return "";
        if (!value.startsWith("http://") && !value.startsWith("https://")) value = "http://" + value;
        while (value.endsWith("/")) value = value.substring(0, value.length() - 1);
        return value;
    }

    private String origin(String raw) {
        try {
            URL u = new URL(raw);
            int port = u.getPort();
            return u.getProtocol() + "://" + u.getHost() + (port > 0 ? ":" + port : "");
        } catch (Exception e) {
            return normalize(raw);
        }
    }

    private void connectManual() {
        String base = normalize(manualAddress.getText().toString());
        if (base.isEmpty()) {
            status.setText("Informe o endereço exibido pelo Worship Deck no PC.");
            return;
        }
        openDeck(base, false);
    }

    private void openDeck(String base, boolean remote) {
        String normalized = normalize(base);
        if (normalized.isEmpty()) return;
        if (remote) prefs.edit().putString(KEY_REMOTE, normalized).apply();
        else prefs.edit().putString(KEY_LOCAL, normalized).apply();
        status.setText(remote ? "Abrindo o acesso remoto…" : "Worship Deck encontrado. Conectando…");
        progress.setVisibility(View.VISIBLE);
        String separator = normalized.contains("?") ? "&" : "?";
        webView.loadUrl(normalized + "/" + separator + "mode=deck&source=apk");
    }

    private void showSetup(String message) {
        main.post(() -> {
            webView.setVisibility(View.GONE);
            setup.setVisibility(View.VISIBLE);
            progress.setVisibility(View.GONE);
            status.setText(message);
        });
    }

    private void showRemoteDialog() {
        EditText field = input("https://seu-worship-deck.vercel.app");
        field.setText(prefs.getString(KEY_REMOTE, ""));
        new AlertDialog.Builder(this)
                .setTitle("Acesso remoto")
                .setMessage("Informe o endereço HTTPS do Worship Deck Web.")
                .setView(field)
                .setNegativeButton("Cancelar", null)
                .setPositiveButton("Salvar e abrir", (dialog, which) -> {
                    String value = normalize(field.getText().toString());
                    if (!value.isEmpty()) openDeck(value, true);
                }).show();
    }

    private void discover(boolean firstStart) {
        if (!searching.compareAndSet(false, true)) return;
        webView.setVisibility(View.GONE);
        setup.setVisibility(View.VISIBLE);
        progress.setVisibility(View.VISIBLE);
        status.setText("Procurando o Deck na rede…");

        background.execute(() -> {
            String found = discoverUdp();
            if (found == null) found = probeSaved();
            if (found == null) found = scanLocalNetwork();
            final String result = found;
            searching.set(false);
            main.post(() -> {
                if (result != null) {
                    openDeck(result, false);
                    return;
                }
                String remote = prefs.getString(KEY_REMOTE, "");
                if (firstStart && !remote.isEmpty()) {
                    openDeck(remote, true);
                    return;
                }
                showSetup("Deck local não encontrado. Informe o endereço do PC ou configure o acesso remoto.");
            });
        });
    }

    private String discoverUdp() {
        WifiManager.MulticastLock lock = null;
        try (DatagramSocket socket = new DatagramSocket()) {
            WifiManager wifi = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            lock = wifi.createMulticastLock("worship-deck-discovery");
            lock.setReferenceCounted(false);
            lock.acquire();
            socket.setBroadcast(true);
            socket.setSoTimeout(1400);
            byte[] request = "WORSHIP_DECK_DISCOVER_V1".getBytes(StandardCharsets.UTF_8);
            socket.send(new DatagramPacket(request, request.length, InetAddress.getByName("255.255.255.255"), DISCOVERY_PORT));
            byte[] buffer = new byte[512];
            DatagramPacket response = new DatagramPacket(buffer, buffer.length);
            socket.receive(response);
            String body = new String(response.getData(), 0, response.getLength(), StandardCharsets.UTF_8);
            if (!body.contains("worship-deck-v1")) return null;
            int port = extractNumber(body, "port", 4177);
            return "http://" + response.getAddress().getHostAddress() + ":" + port;
        } catch (Exception ignored) {
            return null;
        } finally {
            if (lock != null && lock.isHeld()) lock.release();
        }
    }

    private int extractNumber(String json, String key, int fallback) {
        try {
            String marker = "\"" + key + "\":";
            int start = json.indexOf(marker);
            if (start < 0) return fallback;
            start += marker.length();
            int end = start;
            while (end < json.length() && Character.isDigit(json.charAt(end))) end++;
            return Integer.parseInt(json.substring(start, end));
        } catch (Exception e) {
            return fallback;
        }
    }

    private String probeSaved() {
        String saved = prefs.getString(KEY_LOCAL, "");
        return !saved.isEmpty() && isDeck(saved) ? saved : null;
    }

    private List<String> localPrefixes() {
        List<String> prefixes = new ArrayList<>();
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (InetAddress address : Collections.list(ni.getInetAddresses())) {
                    if (!(address instanceof Inet4Address) || address.isLoopbackAddress()) continue;
                    String ip = address.getHostAddress();
                    int dot = ip.lastIndexOf('.');
                    if (dot > 0) prefixes.add(ip.substring(0, dot + 1));
                }
            }
        } catch (Exception ignored) {}
        return prefixes;
    }

    private String scanLocalNetwork() {
        for (String prefix : localPrefixes()) {
            ExecutorService pool = Executors.newFixedThreadPool(32);
            AtomicBoolean done = new AtomicBoolean(false);
            final String[] answer = {null};
            for (int host = 1; host <= 254; host++) {
                final int n = host;
                pool.execute(() -> {
                    if (done.get()) return;
                    for (int port : DECK_PORTS) {
                        String candidate = "http://" + prefix + n + ":" + port;
                        if (isDeck(candidate) && done.compareAndSet(false, true)) {
                            answer[0] = candidate;
                            break;
                        }
                    }
                });
            }
            pool.shutdown();
            long end = System.currentTimeMillis() + 5200;
            while (!done.get() && System.currentTimeMillis() < end) {
                try { Thread.sleep(80); } catch (InterruptedException ignored) { break; }
            }
            pool.shutdownNow();
            if (answer[0] != null) return answer[0];
        }
        return null;
    }

    private boolean isDeck(String base) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(base + "/api/runtime").openConnection();
            connection.setConnectTimeout(500);
            connection.setReadTimeout(700);
            connection.setRequestProperty("Accept", "application/json");
            if (connection.getResponseCode() != 200) return false;
            BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getInputStream()));
            StringBuilder body = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) body.append(line);
            return body.toString().contains("apiContractVersion") || body.toString().contains("\"kind\":\"local\"");
        } catch (Exception ignored) {
            return false;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    @Override
    public void onBackPressed() {
        if (webView.getVisibility() == View.VISIBLE && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        if (webView.getVisibility() == View.VISIBLE) {
            if (System.currentTimeMillis() - backPressedAt < 1800) {
                super.onBackPressed();
            } else {
                backPressedAt = System.currentTimeMillis();
                status.setText("Pressione voltar novamente para fechar.");
            }
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        background.shutdownNow();
        if (webView != null) webView.destroy();
        super.onDestroy();
    }
}
