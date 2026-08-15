FROM node:18-alpine
RUN apk add --no-cache ffmpeg
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 7000
CMD ["node", "server.js"]
