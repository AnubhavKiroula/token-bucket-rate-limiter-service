# Stage 1: Builder
FROM node:22-alpine AS builder

WORKDIR /app

# Copy dependency manifests
COPY package*.json ./
RUN npm ci

# Copy TypeScript configs and source code
COPY tsconfig.json ./
COPY src ./src

# Build production bundle
RUN npm run build

# Stage 2: Runner
FROM node:22-alpine AS runner

WORKDIR /app

# Install only production dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy compiled JavaScript from builder stage
COPY --from=builder /app/dist ./dist

# Expose server port
EXPOSE 3000

# Set environment
ENV NODE_ENV=production

# Start the service
CMD ["npm", "start"]
