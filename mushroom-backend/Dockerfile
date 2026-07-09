FROM node:20-alpine
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3001
# Development entry (NestJS): ensure package.json has `start:dev` script
CMD ["npm", "run", "start:dev"]
