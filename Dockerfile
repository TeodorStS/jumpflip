# syntax=docker/dockerfile:1

###############################################################################
# CS++ Flappy — production image
#
# Two stages: the first installs dependencies (which may need a compiler for
# better-sqlite3), the second copies only what is needed to run. That keeps
# build tools out of the shipped image.
###############################################################################

# ---------- Stage 1: dependencies ----------
# Debian-based (not Alpine) on purpose: better-sqlite3 publishes prebuilt
# binaries for glibc, so this installs in seconds. Alpine uses musl, gets no
# prebuild, and would have to compile from source on every build.
FROM node:22-bookworm-slim AS deps

WORKDIR /app

# Only the manifests first, so Docker can cache this layer. Application code
# changes far more often than dependencies do.
COPY package.json package-lock.json* ./

# python3/make/g++ are a fallback: if a prebuilt binary exists they go unused,
# but without them a missing prebuild fails the build outright. They are
# discarded with this stage.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && npm ci --omit=dev \
 && apt-get purge -y python3 make g++ \
 && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/*

# ---------- Stage 2: runtime ----------
FROM node:22-bookworm-slim AS runtime

# tini reaps zombies and forwards signals, so `docker stop` actually stops the
# process instead of waiting out the timeout. Node as PID 1 does neither well.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=3000 \
    DB_DIR=/data

WORKDIR /app

# Dependencies from the build stage
COPY --from=deps /app/node_modules ./node_modules

# Application code. .dockerignore keeps node_modules, the local db/ and the
# scratch files out of this.
COPY package.json ./
COPY server.js db.js ./
COPY public ./public
COPY scripts ./scripts

# The database lives on a mounted volume, never inside the image, so
# rebuilding or redeploying cannot destroy the scores.
RUN mkdir -p /data && chown -R node:node /data /app

# node:22 ships an unprivileged `node` user. Running as root in a container
# is still root on the host kernel if anything escapes.
USER node

EXPOSE 3000
VOLUME ["/data"]

# Compose and orchestrators use this to know the app is actually serving,
# not merely that the process exists.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]
