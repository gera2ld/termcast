FROM oven/bun:1 AS base
WORKDIR /app

FROM base AS builder
ADD . /app
RUN bun i
RUN cd packages/web && bun run build
RUN cd packages/host && bun run scripts/build.ts js

FROM base
VOLUME /app/data
ENV DATA_DIR=/app/data
RUN apt update && apt install -y ssh && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/packages/web/build /app/build
COPY --from=builder /app/packages/host/dist/termcast.js /app/dist/termcast.js
CMD ["bun", "run", "/app/dist/termcast.js", "serve"]
