FROM oven/bun:1-slim

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --production

COPY . .

ENTRYPOINT ["bun", "run", "src/index.ts"]
CMD ["--help"]
