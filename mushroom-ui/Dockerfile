FROM node:22-alpine
WORKDIR /usr/src/app
# Copy manifest and pnpm lockfile first to leverage Docker layer caching
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml* ./
# Enable Corepack and activate pnpm, then install dependencies using pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate && pnpm install --frozen-lockfile
COPY . .

# Build the Next.js application during image creation.
RUN pnpm run build

ENV NODE_ENV=production

EXPOSE 3000

# Production entry
CMD ["pnpm", "run", "start"]
