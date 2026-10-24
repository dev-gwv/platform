# The support group bot (0280). Node, because Baileys is a Node library; the
# rest of the platform runs on Bun.
FROM node:22.11.0-bookworm-slim
WORKDIR /bot
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server.mjs ./
# The link to the spare phone and the send log live here (a named volume), so
# a rebuild or restart keeps the bot linked.
RUN mkdir -p /data && chown -R node:node /data /bot
USER node
ENV WA_BOT_DATA=/data PORT=3001
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://localhost:3001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
