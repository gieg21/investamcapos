plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val baseUrl = (project.findProperty("investaBaseUrl") as String?) ?: "https://pos.grupoinvesta.com"

android {
    namespace = "com.grupoinvesta.mcapos"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.grupoinvesta.mcapos"
        // Terminales Android de Disglobal: N62/N80/N82/N86/N92 (Android 10–13) y AF910.
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"
        buildConfigField("String", "BASE_URL", "\"$baseUrl\"")
    }

    buildTypes {
        debug {
            // Emulador apuntando al `npm run dev` de la máquina: ./gradlew installDebug -PinvestaBaseUrl=http://10.0.2.2:3000
            manifestPlaceholders["usesCleartext"] = "true"
        }
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            manifestPlaceholders["usesCleartext"] = "false"
        }
    }
    buildFeatures { buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("androidx.swiperefreshlayout:swiperefreshlayout:1.1.0")
    // implementation(files("libs/newland-nsdk.aar")) // TODO(Disglobal)
}
