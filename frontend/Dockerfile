# Debian-based image keeps npm's optional dependency resolution stable on arm64
# FROM node:20-alpine
FROM node:20-slim
WORKDIR /app
COPY package.json /app/
RUN npm install
COPY . /app/
EXPOSE 5173
# Command is provided by docker-compose to run dev server
