FROM node:20-alpine

WORKDIR /app

# Install deps first for better caching
COPY package.json package-lock.json* ./
RUN npm install

# Copy the rest
COPY . .

# Vite already binds 0.0.0.0 in vite.config.js
EXPOSE 5173

# Run via compose: npm run dev
CMD ["npm", "run", "dev"]