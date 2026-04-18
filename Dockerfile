FROM node:20-alpine

WORKDIR /app

# Install dependencies first (cached layer)
COPY proxy/package*.json ./
RUN npm ci --only=production 2>/dev/null || npm install --only=production

# Copy proxy source
COPY proxy/ .

# Create data directories
RUN mkdir -p data orgs

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:8787/config?org=health || exit 1

CMD ["node", "server.js"]
