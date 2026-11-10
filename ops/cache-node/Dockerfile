FROM node:24-bookworm-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9

WORKDIR /app
COPY agent/*.mjs ./
USER node
EXPOSE 8090
CMD ["node", "main.mjs"]
