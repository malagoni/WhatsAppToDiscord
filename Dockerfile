# syntax=docker/dockerfile:1

FROM node:20-alpine
WORKDIR /usr/local/WA2DC
ENV WA2DC_TOKEN=MTMwMzYwNzUyNzI2NjcxMzY1MQ.G0zx54.8foL72wQ9NT1xZvdDNIXvEJOdOHmxysQEw9JPI
COPY . .
RUN npm i
ENTRYPOINT ["node", "src/index.js"]
