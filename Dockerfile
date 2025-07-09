FROM node:18-slim

# Install Chromium and all Puppeteer deps
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    chromium \
    gconf-service libasound2 libc6 libcairo2 libcups2 libdbus-1-3 \
    libexpat1 libfontconfig1 libgcc1 libgconf-2-4 libgdk-pixbuf2.0-0 \
    libglib2.0-0 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 \
    libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 \
    libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 \
    ca-certificates fonts-liberation libxshmfence1 wget --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

# Tell Puppeteer to use the system Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY requirements.txt ./
RUN pip3 install --break-system-packages -r requirements.txt
COPY . .

ENV NODE_ENV=production
EXPOSE 4000
CMD ["npm","start"]
