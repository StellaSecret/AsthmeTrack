# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# capgo/capacitor-social-login checks availability of these Google Play
# Services classes via Class.forName — R8 full mode would strip/rename them.
-keep class com.google.android.gms.auth.api.identity.** { *; }
-keep class com.google.android.gms.common.api.ApiException { *; }
-keep class com.google.android.libraries.identity.googleid.** { *; }
