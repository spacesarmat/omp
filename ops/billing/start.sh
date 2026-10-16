#!/bin/sh
set -e
cd /app
npm install --omit=dev
exec node src/server.mjs
