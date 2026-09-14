// Shared, pinned ephemeral SDK bootstrap. Never touches the application checkout.
export const flutterImage = 'ghcr.io/cirruslabs/flutter:3.44.0@sha256:46691e311715845de03a3ba4753a475476936805b29431b1f00f1816981033f8';
export const flutterBootstrap = `set -eu
sdk="$(dirname "$(dirname "$(readlink -f "$(command -v flutter)")")")"
case "$sdk" in /sdks/flutter|/opt/flutter) ;; *) echo "Unexpected SDK path: $sdk"; exit 1;; esac
git config --global --add safe.directory "$sdk"
git -C "$sdk" fetch --depth 1 origin tag 3.47.1
test "$(git -C "$sdk" rev-parse '3.47.1^{commit}')" = '6655482ec06e547f90abf8ae7590466f4415978d'
git -C "$sdk" checkout --force --detach '6655482ec06e547f90abf8ae7590466f4415978d'
flutter --version
`;
