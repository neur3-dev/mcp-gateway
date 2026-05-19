FROM oven/bun:1 AS builder
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun build --compile --minify --target=bun src/server.ts --outfile=gateway
RUN bun build --compile --minify --target=bun src/cli/index.ts --outfile=mgw

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
RUN useradd -m -u 1000 gateway
WORKDIR /app
COPY --from=builder /app/gateway ./gateway
COPY --from=builder /app/mgw ./mgw
COPY config.example.yaml ./config.yaml
RUN chmod +x ./gateway ./mgw && chown -R gateway:gateway /app
USER gateway
EXPOSE 3000
ENTRYPOINT ["./gateway"]
