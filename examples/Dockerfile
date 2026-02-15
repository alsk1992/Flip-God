FROM node:22-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

COPY dist/ ./dist/

EXPOSE 3141

CMD ["node", "dist/index.js"]
