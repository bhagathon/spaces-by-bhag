FROM node:26-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
# Node runs the TypeScript directly (type stripping); shared types are type-only imports and erased.
COPY src ./src
ENV NODE_ENV=production STORE=firestore PORT=8080
USER node
CMD ["node", "src/index.ts"]
