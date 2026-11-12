#!/usr/bin/env bash
# Classify a pull request file list (git diff --name-only on stdin) for desktop CI.
# Prints desktop=true|false and rust=true|false.
# Push, tags and workflow_dispatch do not call this: the workflow marks both true.
set -euo pipefail

desktop=false
rust=false
while IFS= read -r file || [ -n "${file:-}" ]; do
  [ -n "$file" ] || continue
  case "$file" in
    desktop/*|src/*|mobile/*|design/*|tests/setup/*|package.json|package-lock.json|torrserver.version|tsconfig.json|vite.config.ts|.github/workflows/desktop.yml|scripts/desktop-ci-paths.sh)
      desktop=true
      ;;
  esac
  # Rust apt, the Python peer dependency and cargo test. Cargo files match
  # even outside desktop/src-tauri. The apt installer is a Rust input because
  # Linux cargo test links the packages it installs.
  case "$file" in
    desktop/src-tauri/*|Cargo.toml|Cargo.lock|*/Cargo.toml|*/Cargo.lock|desktop/tests/peer_download.py|desktop/tests/requirements.txt|.github/workflows/desktop.yml|scripts/desktop-ci-paths.sh|scripts/ci-apt-install.sh)
      rust=true
      ;;
  esac
done
printf 'desktop=%s\nrust=%s\n' "$desktop" "$rust"
