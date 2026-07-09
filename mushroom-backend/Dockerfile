FROM node:22-alpine
WORKDIR /usr/src/app
# Copy package manifest and pnpm lockfile first to leverage layer caching
COPY package.json pnpm-lock.yaml* ./
# Enable Corepack and activate pnpm, then install dependencies using pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate && pnpm install --frozen-lockfile --ignore-scripts
COPY . .
EXPOSE 3001
# Development entry (NestJS): ensure `start:dev` exists in package.json and uses watch mode
CMD ["pnpm", "run", "start:dev"]
