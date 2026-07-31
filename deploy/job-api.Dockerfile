FROM node:22-alpine

WORKDIR /app
COPY server ./server

ENV NODE_ENV=production
ENV JOB_API_HOST=0.0.0.0
ENV JOB_API_PORT=8787
ENV JOB_DATA_DIR=/data/jobs

RUN mkdir -p /data/jobs

EXPOSE 8787
CMD ["node", "server/index.mjs"]
