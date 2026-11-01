# syntax=docker/dockerfile:1

FROM --platform=$BUILDPLATFORM node:26-bookworm-slim AS frontend
WORKDIR /src
COPY web/package.json web/package-lock.json ./web/
COPY doc/package.json doc/package-lock.json ./doc/
RUN --mount=type=cache,target=/root/.npm \
    npm --prefix web ci --no-audit --no-fund && \
    npm --prefix doc ci --no-audit --no-fund
COPY web/ ./web/
COPY doc/ ./doc/
RUN npm --prefix web run build && npm --prefix doc run build && \
    cp -R doc/.vitepress/dist web/dist/docs

FROM --platform=$BUILDPLATFORM golang:1.26-alpine3.24 AS backend
ARG TARGETOS
ARG TARGETARCH
WORKDIR /src/server
COPY server/ ./
COPY --from=frontend /src/web/dist ./web/dist
RUN --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -trimpath -buildvcs=false -ldflags="-s -w" -o /out/tiller .

# Prepare architecture-independent runtime files on the build host. Go is
# cross-compiled above, so building arm64 does not need QEMU emulation.
FROM --platform=$BUILDPLATFORM alpine:3.24 AS runtime-files
RUN apk add --no-cache ca-certificates tzdata && \
    addgroup -S -g 65532 tiller && adduser -S -D -H -u 65532 -G tiller tiller && \
    mkdir /data && chown 65532:65532 /data

FROM alpine:3.24
COPY --from=runtime-files /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=runtime-files /usr/share/zoneinfo /usr/share/zoneinfo
COPY --from=runtime-files /etc/passwd /etc/group /etc/
COPY --from=runtime-files --chown=65532:65532 /data /data
COPY --from=backend /out/tiller /usr/local/bin/tiller
USER 65532:65532
WORKDIR /data
ENV LISTEN=:8080
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/tiller"]
