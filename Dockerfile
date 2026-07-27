FROM oven/bun:debian

WORKDIR /app

# Copy dependency manifests first for layer caching
COPY package.json bun.lock ./

# Install dependencies
RUN bun install --frozen-lockfile --production

# Copy source
COPY src/ ./src/
COPY tsconfig.json ./

# Build
RUN bun build src/index.ts --outdir dist

# Create uploads directory
RUN mkdir -p uploads

EXPOSE 3000

CMD ["bun", "run", "dist/index.js"]
