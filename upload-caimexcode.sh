#!/usr/bin/env bash
# upload-caimexcode.sh — publish caimexcode release archives to RustFS
# POSIX-compatible version for bash 3.2 (macOS default)

set -eu

# Add bun to PATH if not already available
if ! command -v bun >/dev/null 2>&1; then
  if [ -f "$HOME/.bun/bin/bun" ]; then
    export PATH="$HOME/.bun/bin:$PATH"
  fi
fi

# Auto-load .env if it exists
if [ -f .env ]; then
  echo "Loaded .env file"
  export $(grep -v '^#' .env | xargs)
fi

# --- Parse arguments --------------------------------------------------
DRY_RUN=false
NO_LATEST=false
VERBOSE=false
while [[ $# -gt 0 ]]; do
  case $1 in
    --dry-run) DRY_RUN=true; shift ;;
    --no-latest) NO_LATEST=true; shift ;;
    --verbose) VERBOSE=true; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# --- Config -----------------------------------------------------------
ALIAS="${ALIAS:-rustfs}"
ENDPOINT="${RUSTFS_ENDPOINT:?set RUSTFS_ENDPOINT}"
ACCESS_KEY="${RUSTFS_ACCESS_KEY:?set RUSTFS_ACCESS_KEY}"
SECRET_KEY="${RUSTFS_SECRET_KEY:?set RUSTFS_SECRET_KEY}"
BUCKET="${RUSTFS_BUCKET:-caimex-code}"
VERSION="${VERSION:-$(cd packages/opencode && bun -e 'console.log(await import("@opencode-ai/script").Script.version)')}"

CAIMEXCODE_DIR="packages/caimexcode"

# --- Temp files for data storage (POSIX-compatible) -------------------
ARCHIVES_FILE=$(mktemp)
CHECKSUMS_FILE=$(mktemp)
UPLOADED_FILE=$(mktemp)

# Cleanup temp files on exit
cleanup_temp() {
  rm -f "$ARCHIVES_FILE" "$CHECKSUMS_FILE" "$UPLOADED_FILE"
}

# Cleanup partial uploads on error
cleanup_partial() {
  if [ -s "$UPLOADED_FILE" ]; then
    echo ""
    echo "Cleaning up partial uploads..."
    while IFS= read -r file; do
      [ -z "$file" ] && continue
      echo -n "  Removing ${file}... "
      mc rm --quiet "${ALIAS}/${BUCKET}/${VERSION}/${file}" 2>/dev/null || true
      echo "✓"
    done < "$UPLOADED_FILE"
  fi
}

trap cleanup_temp EXIT
trap 'cleanup_partial; cleanup_temp' ERR

# --- Helper functions -------------------------------------------------
log() {
  if [ "$VERBOSE" = true ]; then
    echo "$@"
  fi
}

verbose_log() {
  if [ "$VERBOSE" = true ]; then
    echo "$@"
  fi
}

# --- Sanity checks ----------------------------------------------------
[ -d "$CAIMEXCODE_DIR" ] || { echo "Error: No build found at $CAIMEXCODE_DIR"; exit 1; }

# Find release archives (save to temp file instead of array)
find "$CAIMEXCODE_DIR" -maxdepth 1 \( -name "caimexcode-*.tar.gz" -o -name "caimexcode-*.zip" \) > "$ARCHIVES_FILE" 2>/dev/null || true

ARCHIVE_COUNT=$(wc -l < "$ARCHIVES_FILE" | tr -d ' ')

if [ "$ARCHIVE_COUNT" -eq 0 ]; then
  echo "Error: No release archives found in $CAIMEXCODE_DIR"
  echo ""
  echo "To create release archives, build with OPENCODE_RELEASE=1:"
  echo "  OPENCODE_RELEASE=1 ./build-caimexcode.sh"
  echo ""
  echo "This sets Script.release=true which triggers archive creation."
  exit 1
fi

command -v mc >/dev/null || { echo "Error: mc (MinIO client) not found"; exit 1; }

# --- Verify archive integrity (SHA256) --------------------------------
echo "Verifying archive integrity..."

while IFS= read -r archive; do
  [ -z "$archive" ] && continue
  NAME=$(basename "$archive")
  if [ -f "${archive}.sha256" ]; then
    echo -n "  ${NAME}: "
    if sha256sum -c "${archive}.sha256" >/dev/null 2>&1; then
      echo "✓ OK"
    else
      echo "✗ CHECKSUM FAILED"
      exit 1
    fi
    CHECKSUM=$(grep -o '^[a-f0-9]*' "${archive}.sha256")
  else
    echo -n "  ${NAME}: "
    CHECKSUM=$(sha256sum "$archive" | cut -d' ' -f1)
    echo "SHA256: ${CHECKSUM:0:16}..."
  fi
  echo "${NAME}:${CHECKSUM}" >> "$CHECKSUMS_FILE"
done < "$ARCHIVES_FILE"
echo ""

# --- Configure alias (idempotent) -------------------------------------
mc_verbose=""
[ "$VERBOSE" = true ] && mc_verbose="--debug"
mc alias set "$ALIAS" "$ENDPOINT" "$ACCESS_KEY" "$SECRET_KEY" $mc_verbose >/dev/null

# --- Ensure bucket exists ---------------------------------------------
mc mb --ignore-existing "${ALIAS}/${BUCKET}" $mc_verbose >/dev/null

# --- Generate SHA256SUMS file -----------------------------------------
echo "Generating SHA256SUMS..."
> SHA256SUMS
while IFS= read -r archive; do
  [ -z "$archive" ] && continue
  NAME=$(basename "$archive")
  CHECKSUM=$(grep "^${NAME}:" "$CHECKSUMS_FILE" | cut -d: -f2)
  echo "${CHECKSUM}  ${NAME}" >> SHA256SUMS
done < "$ARCHIVES_FILE"

# Upload SHA256SUMS to versioned path
if ! mc cp $mc_verbose SHA256SUMS "${ALIAS}/${BUCKET}/${VERSION}/SHA256SUMS" >/dev/null; then
  echo "⚠️  Warning: failed to upload SHA256SUMS to ${VERSION}/"
else
  echo "  Uploaded SHA256SUMS -> ${ENDPOINT}/${BUCKET}/${VERSION}/SHA256SUMS"
fi

# Upload SHA256SUMS to latest/ if enabled
if [ "$NO_LATEST" = false ]; then
  if ! mc cp $mc_verbose SHA256SUMS "${ALIAS}/${BUCKET}/latest/SHA256SUMS" >/dev/null; then
    echo "⚠️  Warning: failed to upload SHA256SUMS to latest/"
  fi
fi
rm -f SHA256SUMS
echo ""

# --- Dry run mode -----------------------------------------------------
if [ "$DRY_RUN" = true ]; then
  echo "🔍 DRY RUN - No actual upload will occur"
  echo ""
  echo "Would upload ${ARCHIVE_COUNT} archive(s) to:"
  echo "  ${ALIAS}/${BUCKET}/${VERSION}/"
  TOTAL_SIZE=0
  while IFS= read -r archive; do
    [ -z "$archive" ] && continue
    SIZE=$(stat -f%z "$archive" 2>/dev/null || stat -c%s "$archive" 2>/dev/null)
    TOTAL_SIZE=$((TOTAL_SIZE + SIZE))
    echo "    - $(basename "$archive") ($(numfmt --to=iec-i --suffix=B $SIZE 2>/dev/null || echo "${SIZE} bytes"))"
  done < "$ARCHIVES_FILE"
  [ "$NO_LATEST" = false ] && echo "  Would update: ${ALIAS}/${BUCKET}/latest/"
  echo ""
  echo "Total size: $(numfmt --to=iec-i --suffix=B $TOTAL_SIZE 2>/dev/null || echo "${TOTAL_SIZE} bytes")"
  echo ""
  echo "Run without --dry-run to actually upload."
  exit 0
fi

# --- Upload versioned release -----------------------------------------
echo "Uploading ${ARCHIVE_COUNT} archive(s) -> ${ALIAS}/${BUCKET}/${VERSION}/"
TOTAL_SIZE=0

while IFS= read -r archive; do
  [ -z "$archive" ] && continue
  NAME=$(basename "$archive")
  SIZE=$(stat -f%z "$archive" 2>/dev/null || stat -c%s "$archive" 2>/dev/null)
  TOTAL_SIZE=$((TOTAL_SIZE + SIZE))
  
  echo -n "  ${NAME}... "
  
  if ! mc cp $mc_verbose "$archive" "${ALIAS}/${BUCKET}/${VERSION}/" >/dev/null 2>&1; then
    echo "✗ FAILED"
    echo ""
    echo "Upload failed. Rolling back..."
    exit 1
  fi
  
  echo "✓"
  echo "$NAME" >> "$UPLOADED_FILE"
done < "$ARCHIVES_FILE"

# --- Update 'latest' pointer ------------------------------------------
if [ "$NO_LATEST" = false ]; then
  echo ""
  echo "Updating latest/ -> ${VERSION}"
  if ! mc mirror --overwrite --remove $mc_verbose \
      "${ALIAS}/${BUCKET}/${VERSION}/" "${ALIAS}/${BUCKET}/latest/" >/dev/null; then
    echo "⚠️  Warning: failed to update 'latest' pointer (network issue?)."
    echo "   ${VERSION} release itself uploaded successfully and is unaffected."
    echo "   Retry just the pointer with:"
    echo "     mc mirror --overwrite --remove ${ALIAS}/${BUCKET}/${VERSION}/ ${ALIAS}/${BUCKET}/latest/"
  fi
fi

# --- Make publicly readable -------------------------------------------
mc anonymous set download "${ALIAS}/${BUCKET}/${VERSION}" >/dev/null
[ "$NO_LATEST" = false ] && mc anonymous set download "${ALIAS}/${BUCKET}/latest" >/dev/null

# --- Publish install.sh (only for releases) ---------------------------
if [ "$OPENCODE_RELEASE" = "1" ] && [ -f "install.sh" ]; then
  echo ""
  echo "Publishing install.sh..."
  
  should_upload=false
  
  # Check if file exists on bucket
  if mc stat $mc_verbose "${ALIAS}/${BUCKET}/install.sh" >/dev/null 2>&1; then
    # Compare checksums
    local_sum=$(sha256sum install.sh | awk '{print $1}')
    remote_sum=$(mc cat $mc_verbose "${ALIAS}/${BUCKET}/install.sh" 2>/dev/null | sha256sum | awk '{print $1}')
    
    if [ "$local_sum" = "$remote_sum" ]; then
      echo "  install.sh unchanged, skipping upload"
    else
      should_upload=true
    fi
  else
    should_upload=true
  fi
  
  if [ "$should_upload" = true ]; then
    if mc cp $mc_verbose install.sh "${ALIAS}/${BUCKET}/install.sh" >/dev/null; then
      mc anonymous set download "${ALIAS}/${BUCKET}/install.sh" >/dev/null
      echo "  ${ENDPOINT}/${BUCKET}/install.sh"
    else
      echo "  ⚠️  Warning: failed to upload install.sh"
    fi
  fi
fi

# --- Summary ----------------------------------------------------------
UPLOADED_COUNT=$(wc -l < "$UPLOADED_FILE" | tr -d ' ')

echo ""
echo "✅ Release published successfully!"
echo ""
echo "  Version:  ${VERSION}"
echo "  Archives: ${UPLOADED_COUNT}"
echo "  Size:     $(numfmt --to=iec-i --suffix=B $TOTAL_SIZE 2>/dev/null || echo "${TOTAL_SIZE} bytes")"
echo ""
echo "  Location: ${ENDPOINT}/${BUCKET}/${VERSION}/"
[ "$NO_LATEST" = false ] && echo "  Latest:   ${ENDPOINT}/${BUCKET}/latest/"
echo "  SHA256SUMS: ${ENDPOINT}/${BUCKET}/${VERSION}/SHA256SUMS"
[ "$NO_LATEST" = false ] && echo "  SHA256SUMS: ${ENDPOINT}/${BUCKET}/latest/SHA256SUMS"
if [ "$OPENCODE_RELEASE" = "1" ] && [ -f "install.sh" ]; then
  echo "  Installer:  ${ENDPOINT}/${BUCKET}/install.sh"
fi
echo ""
echo "Download commands:"
while IFS= read -r NAME; do
  [ -z "$NAME" ] && continue
  echo "  mc cp ${ALIAS}/${BUCKET}/${VERSION}/${NAME} ."
done < "$UPLOADED_FILE"

if [ "$VERBOSE" = true ]; then
  echo ""
  echo "Checksums:"
  while IFS= read -r NAME; do
    [ -z "$NAME" ] && continue
    CHECKSUM=$(grep "^${NAME}:" "$CHECKSUMS_FILE" | cut -d: -f2)
    echo "  ${NAME}: ${CHECKSUM}"
  done < "$UPLOADED_FILE"
fi
