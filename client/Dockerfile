# client/Dockerfile
FROM node:18-alpine
RUN apk add --no-cache procps
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
CMD ["node", "index.js"]