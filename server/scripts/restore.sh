#!/bin/sh
set -eu

if [ "${1:-}" = "" ]; then
  echo "Usage: npm run restore -- /path/to/backup-folder"
  exit 1
fi

MONGO_URI="${MONGODB_URI:-mongodb://127.0.0.1:27017/messenger-mvp}"
mongorestore --uri="$MONGO_URI" --drop "$1"
echo "Restore completed from $1"
