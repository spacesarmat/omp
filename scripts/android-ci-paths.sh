#!/usr/bin/env bash
# Classify a pull request file list (git diff --name-only on stdin) for the android CI job.
# Prints android=true|false.
# Push and workflow_dispatch do not call this: the workflow marks android=true.
# true means the pull request must run android:sync, the debug build and the unit tests.
# Inputs are what "Sync the web app into the Android project" reads, plus the Gradle project and this workflow.
set -euo pipefail

android=false
while IFS= read -r file || [ -n "${file:-}" ]; do
  [ -n "$file" ] || continue
  case "$file" in
    android/*|\
    src/*|\
    mobile/*|\
    index.html|\
    capacitor.config.ts|\
    vite.mobile.config.ts|\
    vite.tv-android.config.ts|\
    tsconfig.json|\
    package.json|\
    package-lock.json|\
    torrserver.version|\
    .gitmodules|\
    scripts/torrserver-pin.mjs|\
    scripts/torrserver-lib.mjs|\
    scripts/strip-flatdir.mjs|\
    scripts/flatdir-lib.mjs|\
    scripts/android-ci-paths.sh|\
    .github/workflows/ci.yml)
      android=true
      ;;
  esac
done
printf 'android=%s\n' "$android"
