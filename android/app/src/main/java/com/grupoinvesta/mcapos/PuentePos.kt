package com.grupoinvesta.mcapos

import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import android.webkit.JavascriptInterface

/**
 * Lo que la página /pos puede preguntarle a la terminal (window.InvestaPOS).
 *
 * El serial es la pieza de seguridad del onboarding: el servidor solo muestra la ficha de Disglobal
 * si el serial de esta terminal está registrado a nombre del RIF que se escribió.
 */
class PuentePos(private val ctx: Context) {

    @JavascriptInterface
    fun serial(): String = serialTerminal

    @JavascriptInterface
    fun modelo(): String = Build.MODEL ?: ""

    /** Sin cámara (algunos modelos), la app ofrece solo el KYC con el teléfono por QR. */
    @JavascriptInterface
    fun tieneCamara(): Boolean = ctx.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)

    private val serialTerminal: String by lazy { leerSerial() }

    @SuppressLint("HardwareIds", "MissingPermission")
    private fun leerSerial(): String {
        // TODO(Disglobal): leer el serial con el SDK de Newland (N-series), que es el que Disglobal tiene
        // registrado por terminal, p. ej. DeviceInfo de NSDK. Build.getSerial() solo funciona si el
        // fabricante concede READ_PRIVILEGED_PHONE_STATE a la app (Android 10+).
        try {
            val s = Build.getSerial()
            if (!s.isNullOrBlank() && s != Build.UNKNOWN) return s
        } catch (_: SecurityException) { /* sin permiso privilegiado */ }
        // Último recurso: identificador del equipo. No coincidirá con Disglobal y el servidor lo rechazará en producción.
        return "AID-" + Settings.Secure.getString(ctx.contentResolver, Settings.Secure.ANDROID_ID)
    }
}
