FROM node:20-alpine
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3000
# Development entry (use `npm run dev` in package.json)
CMD ["npm", "run", "dev"]
