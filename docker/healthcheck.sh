#!/bin/sh
# VoltLink role-aware container healthcheck.
# web/status: probe the HTTP healthz endpoint. worker/scheduler: process liveness.
set -eu

role="${VL_ROLE:-web}"
port="${PORT:-3000}"

case "$role" in
  web|status)
    node -e "fetch('http://127.0.0.1:'+process.argv[1]+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" "$port"
    ;;
  worker|scheduler)
    # Liveness: this script only runs while the main process is alive;
    # also verify the queue backend is reachable when Redis is configured.
    if [ -n "${REDIS_URL:-}" ]; then
      node -e "const R=require('ioredis');const c=new R(process.env.REDIS_URL,{lazyConnect:true,maxRetriesPerRequest:1});c.ping().then(()=>{c.disconnect();process.exit(0)}).catch(()=>process.exit(1))"
    else
      node -e "process.exit(0)"
    fi
    ;;
  *)
    exit 0
    ;;
esac
