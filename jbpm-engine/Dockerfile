# syntax=docker/dockerfile:1.7
#
# Orkestr engine API (jbpm-engine/server) with a JDK, so scripts written in Java work in production.
#
# BUILD CONTEXT = the repository root (the server depends on the local ../../bpmn-sdk package):
#     docker build -f jbpm-engine/Dockerfile -t orkestr-engine .
#
# Why a JDK and not just a JRE: the Java script dialect is compiled at runtime — a persistent JVM sidecar
# (jbpm-engine/java-runtime) runs `javac` on each distinct script. The image therefore ships the JDK, the
# precompiled sidecar classes, and JAVA_HOME. The build FAILS if the sidecar classes were not produced
# (the repo's `build:sidecar` step silently skips itself when javac is missing).
#
# Not included: the Angular app (serve it from any static host / nginx and proxy /api and /ws to this service).
ARG NODE_VERSION=22

# ---------- build ----------
FROM node:${NODE_VERSION}-bookworm AS build
RUN apt-get update \
 && apt-get install -y --no-install-recommends openjdk-17-jdk-headless \
 && rm -rf /var/lib/apt/lists/*
# UTF-8 everywhere: the JDK defaults to US-ASCII in a POSIX-locale container and then cannot compile the sidecar sources
ENV LANG=C.UTF-8 LC_ALL=C.UTF-8 JAVA_TOOL_OPTIONS="-Dfile.encoding=UTF-8"
RUN ln -s "$(dirname "$(dirname "$(readlink -f "$(which javac)")")")" /opt/java
WORKDIR /build

# local SDK (file:../../bpmn-sdk relative to jbpm-engine/server)
COPY bpmn-sdk/package.json bpmn-sdk/package-lock.json bpmn-sdk/tsconfig.json* bpmn-sdk/tsup.config.* ./bpmn-sdk/
RUN cd bpmn-sdk && npm ci --no-audit --no-fund
COPY bpmn-sdk/src ./bpmn-sdk/src
RUN cd bpmn-sdk && npm run build && ls dist/index.js

# server dependencies (workspace root + server only; the Angular app is not part of this image)
COPY jbpm-engine/package.json jbpm-engine/package-lock.json ./jbpm-engine/
COPY jbpm-engine/server/package.json ./jbpm-engine/server/
COPY jbpm-engine/app/package.json ./jbpm-engine/app/
RUN cd jbpm-engine && npm ci --workspace server --include-workspace-root --no-audit --no-fund

# sources, JVM sidecar classes, bundle
COPY jbpm-engine/server ./jbpm-engine/server
COPY jbpm-engine/java-runtime/src ./jbpm-engine/java-runtime/src
ENV PATH="/opt/java/bin:${PATH}"
RUN cd jbpm-engine && npm run build --workspace server \
 && test -f java-runtime/out/bpmscript/Server.class \
 || (echo "FATAL: JVM sidecar classes were not compiled — is a JDK present?" >&2; exit 1)
# keep only production dependencies for the runtime stage
RUN cd jbpm-engine && npm prune --omit=dev --workspace server --include-workspace-root

# ---------- runtime ----------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends openjdk-17-jdk-headless tini ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && ln -s "$(dirname "$(dirname "$(readlink -f "$(which javac)")")")" /opt/java \
 && mkdir -p /data && chown node:node /data

ENV NODE_ENV=production \
    PORT=4000 \
    DATA_DIR=/data \
    JAVA_HOME=/opt/java \
    PATH="/opt/java/bin:${PATH}" \
    JAVA_SIDECAR_CLASSPATH=/app/jbpm-engine/java-runtime/out \
    # the sidecar JVM is one long-lived process per pod: cap it so it cannot starve the Node process
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    JAVA_TOOL_OPTIONS="-Dfile.encoding=UTF-8 -XX:MaxRAMPercentage=25 -XX:+UseSerialGC"

# same relative layout as in the build stage (the SDK is linked as ../../bpmn-sdk)
WORKDIR /app
COPY --from=build /build/bpmn-sdk/package.json ./bpmn-sdk/package.json
COPY --from=build /build/bpmn-sdk/dist ./bpmn-sdk/dist
COPY --from=build /build/jbpm-engine/package.json ./jbpm-engine/package.json
COPY --from=build /build/jbpm-engine/node_modules ./jbpm-engine/node_modules
COPY --from=build /build/jbpm-engine/server/package.json ./jbpm-engine/server/package.json
COPY --from=build /build/jbpm-engine/server/dist ./jbpm-engine/server/dist
COPY --from=build /build/jbpm-engine/java-runtime/out ./jbpm-engine/java-runtime/out

USER node
WORKDIR /app/jbpm-engine/server
VOLUME /data
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/index.js"]
