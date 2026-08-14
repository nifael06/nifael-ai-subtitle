FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 7000
ENV PORT=7000
CMD ["node", "server.js"]
