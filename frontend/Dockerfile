FROM node:20-alpine
WORKDIR /app
COPY package.json /app/
RUN npm install
COPY . /app/
EXPOSE 5173
# Command is provided by docker-compose to run dev server
