# syntax=docker/dockerfile:1

FROM node:20-alpine
WORKDIR /usr/local/WA2DC
ENV WA2DC_TOKEN=_HERE_TOKEN_
COPY . .
RUN npm i
ENTRYPOINT ["node", "src/index.js"]
