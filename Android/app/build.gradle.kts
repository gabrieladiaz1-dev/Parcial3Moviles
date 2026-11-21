import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
}

val supabaseLocal = Properties().apply {
    val configFile = rootProject.file("supabase.properties")
    if (configFile.exists()) configFile.inputStream().use { load(it) }
}
fun configLiteral(value: String): String =
    "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "").replace("\r", "") + "\""

val supabaseUrl = supabaseLocal.getProperty("SUPABASE_URL", "https://uvebpsbbwofthucghccc.supabase.co").trim()
val supabaseKey = supabaseLocal.getProperty("SUPABASE_PUBLISHABLE_KEY", "").trim()
require(supabaseUrl == "https://uvebpsbbwofthucghccc.supabase.co") { "Unexpected Supabase project URL" }
require(supabaseKey.isEmpty() || supabaseKey.startsWith("sb_publishable_")) { "Use only a Supabase Publishable Key" }

android {
    namespace = "sv.edu.catolica.hospital_universitario"
    compileSdk = 37

    defaultConfig {
        applicationId = "sv.edu.catolica.hospital_universitario"
        minSdk = 26
        targetSdk = 37
        versionCode = 1
        versionName = "1.0"
        buildConfigField("String", "SUPABASE_URL", configLiteral(supabaseUrl))
        buildConfigField("String", "SUPABASE_PUBLISHABLE_KEY", configLiteral(supabaseKey))

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
    buildFeatures {
        viewBinding = true
        buildConfig = true
        compose = false
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation("androidx.appcompat:appcompat:1.6.1")
    implementation("com.google.android.material:material:1.11.0")
    implementation("androidx.constraintlayout:constraintlayout:2.1.4")
    // MVVM + corrutinas (viewModelScope); permitidas en AGENTS.md
    implementation("androidx.lifecycle:lifecycle-viewmodel-ktx:2.8.7")
    implementation("androidx.activity:activity-ktx:1.9.0")
    testImplementation(libs.junit)
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.androidx.espresso.core)
}
