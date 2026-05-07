# ownloom-gateway

Run `npm ci` after package-lock changes so local `node_modules` matches the
lockfile. The Baileys tree uses a protobuf override; stale local installs can
report `protobufjs@6.8.8 invalid` until `npm ci` refreshes dependencies.

Use `npm run audit` to run both `npm audit` and the lockfile-only protobuf
dependency check.
