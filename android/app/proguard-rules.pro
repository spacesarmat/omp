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

# Install assistant (minify is off today; kept for when it is turned on):
# JSch creates ciphers, key exchanges and key types by class name from its config.
-keep class com.jcraft.jsch.** { *; }
# optional JSch integrations that are not on the classpath (Bouncy Castle, JNA, loggers)
-dontwarn com.jcraft.jsch.**
-dontwarn org.bouncycastle.**
-dontwarn com.sun.jna.**
-dontwarn org.slf4j.**
-dontwarn org.apache.logging.log4j.**
