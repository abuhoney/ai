# Keep Z.AI SDK bridge and JavaScript interface
-keep class com.bardompro.zai.** { *; }
-keepclassmembers class com.bardompro.zai.MainActivity$BardomBridge {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class android.webkit.JavascriptInterface { *; }
