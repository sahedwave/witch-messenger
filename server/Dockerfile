FROM node:22-alpine

WORKDIR /app

COPY package.json ./
RUN npm install

COPY src ./src
COPY scripts ./scripts

EXPOSE 5001

CMD ["npm", "run", "start"]

