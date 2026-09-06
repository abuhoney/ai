#!/usr/bin/env bash
# ============================================================
# build-apk-v3.sh — Build BardomPro AI v3.0.0 APK
# Pipeline: aapt2 compile -> aapt2 link -> ECJ compile -> d8 -> zipalign -> apksigner
# Uses ECJ instead of javac (javac not available in some environments).
# ============================================================
set -e

PROJECT_ROOT="/home/z/my-project/download/BardomPro-v3/z-ai-web-dev-sdk"
ANDROID_HOME="${ANDROID_HOME:-/home/z/my-project/download/ai-app/android-sdk}"
BT_VERSION="35.0.0"
BUILD_TOOLS="$ANDROID_HOME/build-tools/$BT_VERSION"
PLATFORM_JAR="$ANDROID_HOME/platforms/android-35/android.jar"
ECJ_JAR="${ECJ_JAR:-/home/z/my-project/download/ai-app/ecj.jar}"

# Project source
APP_DIR="$PROJECT_ROOT/android/app/src/main"
RES_DIR="$APP_DIR/res"
ASSETS_DIR="$APP_DIR/assets"
MANIFEST="$APP_DIR/AndroidManifest.xml"
SRC_DIR="$APP_DIR/java"

# Build output
BUILD_DIR="$PROJECT_ROOT/android/build"
GEN_DIR="$BUILD_DIR/gen"
OBJ_DIR="$BUILD_DIR/obj"
APK_DIR="$BUILD_DIR/apk"
LIBS_DIR="$BUILD_DIR/libs"
OUT_APK="$PROJECT_ROOT/BardomPro-AI-v3.apk"

mkdir -p "$GEN_DIR" "$OBJ_DIR" "$APK_DIR" "$LIBS_DIR"

echo "=== Build configuration ==="
echo "  Project root : $PROJECT_ROOT"
echo "  Android SDK  : $ANDROID_HOME"
echo "  Build tools  : $BUILD_TOOLS"
echo "  Platform     : $PLATFORM_JAR"
echo "  ECJ          : $ECJ_JAR"
echo "  Output       : $OUT_APK"
echo ""

# ---- 1. Compile resources ----------------------------------
echo "==== 1. Compile resources with aapt2 ===="
rm -f "$GEN_DIR/compiled-res.zip"
"$BUILD_TOOLS/aapt2" compile --dir "$RES_DIR" -o "$GEN_DIR/compiled-res.zip"

# ---- 2. Link resources -------------------------------------
echo "==== 2. Link resources -> base.apk + R.java ===="
rm -rf "$GEN_DIR/src"
mkdir -p "$GEN_DIR/src"
LINK_ARGS=(
    "$BUILD_TOOLS/aapt2" link
    --manifest "$MANIFEST"
    -I "$PLATFORM_JAR"
    --java "$GEN_DIR/src"
    --min-sdk-version 21
    --target-sdk-version 35
    --auto-add-overlay
    -o "$APK_DIR/base.apk"
)
if [ -d "$ASSETS_DIR" ] && [ -n "$(ls -A "$ASSETS_DIR" 2>/dev/null)" ]; then
    LINK_ARGS+=(-A "$ASSETS_DIR")
fi
LINK_ARGS+=("$GEN_DIR/compiled-res.zip")
"${LINK_ARGS[@]}"

# ---- 3. Compile Java sources with ECJ ----------------------
echo "==== 3. Compile Java sources with ECJ ===="
JAVA_FILES=$(find "$SRC_DIR" "$GEN_DIR/src" -name "*.java" 2>/dev/null)
echo "  Java files: $JAVA_FILES"
java -jar "$ECJ_JAR" -8 -nowarn -encoding UTF-8 \
    -classpath "$PLATFORM_JAR" \
    -d "$OBJ_DIR" \
    $JAVA_FILES

# ---- 4. Dex ------------------------------------------------
echo "==== 4. Dex (.class -> classes.dex) ===="
rm -f "$LIBS_DIR/classes.dex"
CLASS_FILES=$(find "$OBJ_DIR" -name "*.class")
"$BUILD_TOOLS/d8" \
    --min-api 21 \
    --lib "$PLATFORM_JAR" \
    --output "$LIBS_DIR" \
    $CLASS_FILES

# ---- 5. Merge dex into base.apk ----------------------------
echo "==== 5. Build unsigned APK ===="
UNSIGNED_APK="$APK_DIR/app-unsigned.apk"
cp "$APK_DIR/base.apk" "$UNSIGNED_APK"
if [ -f "$LIBS_DIR/classes.dex" ]; then
    (cd "$LIBS_DIR" && zip -j -0 "$UNSIGNED_APK" classes.dex)
fi
# Re-add assets preserving path
if [ -d "$ASSETS_DIR" ]; then
    (cd "$APP_DIR" && find assets -type f -exec zip -0 "$UNSIGNED_APK" {} \;)
fi

# ---- 6. zipalign -------------------------------------------
echo "==== 6. Align APK with zipalign ===="
ALIGNED_APK="$APK_DIR/app-aligned.apk"
"$BUILD_TOOLS/zipalign" -f -p 4 "$UNSIGNED_APK" "$ALIGNED_APK"

# ---- 7. Sign -----------------------------------------------
echo "==== 7. Sign APK with release keystore ===="
KEYSTORE="$PROJECT_ROOT/android/release.keystore"
KEY_ALIAS="bardom-release"
STORE_PASS="bardom_release_2026"
KEY_PASS="bardom_release_2026"

if [ ! -f "$KEYSTORE" ]; then
    echo "  Generating release keystore (25-year validity)..."
    keytool -genkey -v \
        -keystore "$KEYSTORE" \
        -alias "$KEY_ALIAS" \
        -keyalg RSA -keysize 2048 -validity 9125 \
        -storepass "$STORE_PASS" -keypass "$KEY_PASS" \
        -dname "CN=BardomPro, OU=BardomPro Mobile, O=Bardom, L=Riyadh, ST=Riyadh, C=SA"
fi

mkdir -p "$(dirname "$OUT_APK")"
"$BUILD_TOOLS/apksigner" sign \
    --ks "$KEYSTORE" \
    --ks-key-alias "$KEY_ALIAS" \
    --ks-pass "pass:$STORE_PASS" \
    --key-pass "pass:$KEY_PASS" \
    --out "$OUT_APK" \
    "$ALIGNED_APK"

# ---- 8. Verify ---------------------------------------------
echo "==== 8. Verify signature ===="
"$BUILD_TOOLS/apksigner" verify --verbose "$OUT_APK"

echo ""
echo "==== DONE ===="
ls -la "$OUT_APK"
