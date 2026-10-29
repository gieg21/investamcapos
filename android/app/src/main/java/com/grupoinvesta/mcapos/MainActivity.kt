package com.grupoinvesta.mcapos

import android.annotation.SuppressLint
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.webkit.CookieManager
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout

/**
 * App de Investa para las terminales Android de Disglobal.
 *
 * Es un contenedor delgado: abre {BASE_URL}/pos en un WebView y le expone el serial de la terminal
 * por `window.InvestaPOS`. Toda la lógica (onboarding por RIF, scoring, oferta, pagos) vive en el
 * servidor, así una actualización no obliga a reinstalar la app en cada punto de venta.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var web: WebView
    private lateinit var refresh: SwipeRefreshLayout
    private val origen by lazy { Uri.parse(BuildConfig.BASE_URL) }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val puente = PuentePos(this)

        web = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.setSupportMultipleWindows(false)
            settings.userAgentString = settings.userAgentString + " InvestaPOS/${BuildConfig.VERSION_NAME}"
            addJavascriptInterface(puente, "InvestaPOS")
            webViewClient = Cliente()
        }
        // La sesión del POS es una cookie httpOnly del mismo origen; se conserva entre reinicios.
        CookieManager.getInstance().setAcceptCookie(true)

        refresh = SwipeRefreshLayout(this).apply {
            setColorSchemeColors(getColor(R.color.brand))
            setOnRefreshListener { web.reload() }
            addView(web)
        }
        setContentView(refresh)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() { if (web.canGoBack()) web.goBack() else finish() }
        })

        if (savedInstanceState == null) {
            val url = origen.buildUpon().path("/pos").appendQueryParameter("serial", puente.serial()).build()
            web.loadUrl(url.toString())
        } else web.restoreState(savedInstanceState)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onPause() {
        super.onPause()
        CookieManager.getInstance().flush()
    }

    private inner class Cliente : WebViewClient() {
        /** Solo se navega dentro del servidor de Investa; cualquier otro enlace se bloquea. */
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val u = request.url
            return !(u.scheme == origen.scheme && u.host == origen.host && u.port == origen.port)
        }

        override fun onPageFinished(view: WebView, url: String) { refresh.isRefreshing = false }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (!request.isForMainFrame) return
            refresh.isRefreshing = false
            val aviso = TextView(this@MainActivity).apply {
                text = getString(R.string.sin_conexion)
                gravity = Gravity.CENTER
                textSize = 18f
                setPadding(48, 48, 48, 48)
                setOnClickListener { setContentView(refresh); web.reload() }
            }
            setContentView(aviso)
        }
    }
}
