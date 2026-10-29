# App Android para POS Disglobal

Contenedor WebView de la app `/pos` del servidor. Lo instala Disglobal en sus terminales Android (N62, N80, N82, N86, N92, AF910).

- `MainActivity.kt`: abre `{BASE_URL}/pos?serial=…`, solo navega dentro de ese origen, guarda la cookie de sesión y muestra un aviso sin conexión.
- `PuentePos.kt`: expone `window.InvestaPOS.serial()` y `modelo()` a la página.

## Compilar

Requiere Android Studio (o JDK 17 + Android SDK 34). La primera vez, genera el wrapper con `gradle wrapper` o abre la carpeta en Android Studio.

```bash
./gradlew assembleRelease -PinvestaBaseUrl=https://pos.grupoinvesta.com
./gradlew installDebug -PinvestaBaseUrl=http://10.0.2.2:3000   # emulador contra `npm run dev`
```

## Pendiente con Disglobal

1. **SDK de Newland** para leer el serial de la terminal (ver `PuentePos.leerSerial`). Sin él, el serial no coincide con el de Disglobal y en producción el servidor rechaza el onboarding.
2. Firma del APK y canal de distribución a las terminales (MDM / tienda de Disglobal).
