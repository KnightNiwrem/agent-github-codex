FROM oven/bun:1-slim

WORKDIR /app

# Copy package.json and bun.lock files
COPY package.json bun.lock ./

# Install dependencies
RUN bun install --production

# Copy source code
COPY . .

# Expose port
EXPOSE 3000

# Start the application
CMD ["bun", "start"]