#!/bin/sh
set -eu

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
OUTPUT_DIR="${BACKUP_DIR:-./backups}/$TIMESTAMP"
MONGO_URI="${MONGODB_URI:-mongodb://127.0.0.1:27017/messenger-mvp}"

mkdir -p "$OUTPUT_DIR"
mongodump --uri="$MONGO_URI" --out="$OUTPUT_DIR"
echo "Backup created at $OUTPUT_DIR"
