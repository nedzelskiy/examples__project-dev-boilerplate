#!/bin/bash
eval `grep "^export " ./scripts/env.sh` && \
node ./scripts/concurrently-wrapper.js \
"node microservices/server-app-restarter.js" \
"node microservices/server-static-watcher.js" \
"node microservices/server-tests-watcher.js" \
"node microservices/server-browser-restarter.js" \
"node microservices/server-livereload-proxy.js" \
"node node_modules/tsc-watch/tsc-watch.js --outDir "${SERVER__BUILD_FOLDER}" -p {CONFIGS_SERVICES__DIR}/tsconfig-server.json --onSuccess \"node ./scripts/build-server-script.js\""