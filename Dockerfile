FROM --platform=linux/amd64 node:16-alpine

RUN npm install -g pnpm

RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app


# for caching
COPY .npmrc package.json pnpm-lock.yaml ./
COPY ./lib ./lib
COPY ./generator/package.json ./generator/pnpm-lock.yaml ./
COPY ./monitor/package.json ./monitor/pnpm-lock.yaml ./

RUN pnpm install


COPY . /usr/src/app
RUN pnpm build

CMD [ "pnpm", "run", "start:prod" ]