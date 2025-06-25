FROM node:18-slim

# Install Chromium, Xvfb, and all Puppeteer deps
RUN apt-get update && apt-get install -y \
    chromium \
    xvfb \
    gconf-service libasound2 libc6 libcairo2 libcups2 libdbus-1-3 \
    libexpat1 libfontconfig1 libgcc1 libgconf-2-4 libgdk-pixbuf2.0-0 \
    libglib2.0-0 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 \
    libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 \
    libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 \
    ca-certificates fonts-liberation libxshmfence1 wget --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .

ENV NODE_ENV=production
EXPOSE 4000 9222 

# Wrap your start command in Xvfb
CMD ["sh","-c","xvfb-run --server-args='-screen 0 1280x1024x24' npm start"]
