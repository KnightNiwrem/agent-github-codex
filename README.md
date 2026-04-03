# copilot-bun

A Bun project initialized with TypeScript support, Biome for checking, and TypeScript for type checking.

## Getting Started

### Prerequisites
- [Bun](https://bun.sh/) installed on your machine
- [Docker](https://www.docker.com/) (optional, for containerized deployment)

### Installation

```bash
# Install dependencies
bun install
```

### Development

```bash
# Run the application
bun start

# Run with watch mode
bun dev
```

### Code Quality

Always run the following commands before completing any tasks:

```bash
# Run checks
bun run check

# Fix Biome issues
bun run check:fix

# Run type checking
bun typecheck
```

Make sure checks, type checking, and tests pass successfully before submitting your work.

### Docker

This project can be run in a Docker container:

```bash
# Build and start the container
docker-compose up -d

# View logs
docker-compose logs -f

# Stop the container
docker-compose down
```
