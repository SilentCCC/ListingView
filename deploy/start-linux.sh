#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
DATA_DIR=${DATA_DIR:-"$ROOT_DIR/data"}
PORT=${PORT:-4000}
CLIENT_DIST_DIR=${CLIENT_DIST_DIR:-"$ROOT_DIR/client/dist"}
CORS_ORIGIN=${CORS_ORIGIN:-"http://localhost:4000"}

mkdir -p "$DATA_DIR/uploads"
npm ci
npm --prefix "$ROOT_DIR/client" ci
npm --prefix "$ROOT_DIR/server" ci
npm --prefix "$ROOT_DIR/client" run build
npm --prefix "$ROOT_DIR/server" run build

export NODE_ENV=production
export DATA_DIR CLIENT_DIST_DIR PORT CORS_ORIGIN
exec npm --prefix "$ROOT_DIR/server" run start
