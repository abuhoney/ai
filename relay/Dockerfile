# Z.AI Relay Server - Dockerfile for Fly.io
# Lightweight Node.js image for the relay server

FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files first (for caching)
COPY package.json package-lock.json* ./

# Install production dependencies only
RUN npm install --omit=dev --no-audit --no-fund

# Copy application code
COPY server.js ./

# Expose the port the app runs on
ENV PORT=3000
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O- http://localhost:3000/healthz || exit 1

# Run as non-root user for security
USER node

# Start the relay server
CMD ["node", "server.js"]
