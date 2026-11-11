# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.

# youtubedl-android unpacks its Python/ffmpeg payload with Apache Commons
# Compress. ExtraFieldUtils creates the ZipExtraField implementations by
# reflection, so R8 must not remove, merge or rename them. Without these rules
# the release APK crashes with "class ... is not a concrete class" on the first
# yt-dlp run (for example, a Yandex Music playlist link).
-keep class org.apache.commons.compress.archivers.zip.** { *; }
-keep class com.yausername.youtubedl_android.** { *; }
-keep class com.yausername.ffmpeg.** { *; }
-keep class com.yausername.youtubedl_common.** { *; }
-keepclassmembers class * implements org.apache.commons.compress.archivers.zip.ZipExtraField {
    *;
}
-keepattributes *Annotation*, InnerClasses, Signature, EnclosingMethod
-dontwarn org.apache.commons.compress.**
-dontwarn com.yausername.**
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