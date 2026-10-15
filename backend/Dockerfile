FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
RUN mkdir -p /app/data && chown -R node:node /app/data
ENV PORT=8787 DATA_FILE=/app/data/channels.json
EXPOSE 8787
VOLUME ["/app/data"]
USER node
CMD ["node", "src/server.mjs"]
