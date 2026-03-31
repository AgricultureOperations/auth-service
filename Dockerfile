# Build stage
FROM node:20-alpine AS builder
WORKDIR /app

# Install build dependencies for native modules (better-sqlite3, bcrypt, etc.)
RUN apk add --no-cache python3 make g++

# Copy dependency files
COPY package*.json ./

# Install all dependencies
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# Production stage
FROM node:20-alpine
WORKDIR /app

ENV NODE_ENV=production

# Create folder and assign permissions
RUN mkdir -p /app/data && chown -R node:node /app

# Install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled app
COPY --from=builder /app/dist ./dist

USER node

EXPOSE 3000
CMD ["node", "dist/server.js"]