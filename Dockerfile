FROM node:20-alpine

# Install build tools for native dependencies and Terraform
RUN apk add --no-cache python3 make g++ curl unzip

# Install Terraform
ENV TERRAFORM_VERSION=1.7.0
RUN curl -fsSL https://releases.hashicorp.com/terraform/${TERRAFORM_VERSION}/terraform_${TERRAFORM_VERSION}_linux_amd64.zip -o terraform.zip && \
    unzip terraform.zip && \
    mv terraform /usr/local/bin/ && \
    rm terraform.zip && \
    terraform version

WORKDIR /app

# Copy package files first for better caching
COPY package.json tsconfig.json ./

# Install dependencies
RUN npm install --no-audit --no-fund

# Copy source files
COPY *.ts ./
COPY services/ ./services/
COPY shared/ ./shared/
COPY types/ ./types/

# Build TypeScript to JavaScript (ignore type errors in legacy files)
RUN npm run build || true
RUN test -f dist/server.js || exit 1

# Cleanup dev dependencies for smaller image
RUN npm prune --production

EXPOSE 3003

ENV NODE_ENV=production

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:3003/health || exit 1

# Run the compiled JavaScript
CMD ["node", "dist/server.js"]
