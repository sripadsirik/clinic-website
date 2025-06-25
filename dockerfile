# 1. Base on the official Node image
FROM node:18-slim

# 2. Install system libraries Puppeteer’s Chromium needs
RUN apt-get update && apt-get install -y \
    gconf-service libasound2 libc6 libcairo2 libcups2 libdbus-1-3 \
    libexpat1 libfontconfig1 libgcc1 libgconf-2-4 libgdk-pixbuf2.0-0 \
    libglib2.0-0 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 \
    libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 \
    libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 \
    ca-certificates fonts-liberation libxshmfence1 wget --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

# 3. Allow Puppeteer to download & use its own Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=false
# (Your .puppeteerrc.cjs already has skipDownload: false)

# 4. App directory & deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

# 5. Copy code & build
COPY . .

# 6. Production mode
ENV NODE_ENV=production

# 7. Launch the Express + scraper
CMD ["npm", "start"]
