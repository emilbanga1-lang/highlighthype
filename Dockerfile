FROM node:24-alpine
WORKDIR /app
COPY package.json ./
COPY server.js ./
COPY public ./public
RUN mkdir -p /app/data
ENV NODE_ENV=production DATA_DIR=/app/data
EXPOSE 3000
CMD ["node", "server.js"]
