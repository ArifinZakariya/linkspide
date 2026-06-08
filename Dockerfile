FROM node:20-slim

RUN apt-get update && apt-get install -y \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    libatspi2.0-0 \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
RUN CHROME_DIR=$(find /root/.cache/puppeteer -type d -name "chrome-linux64" 2>/dev/null | head -1) && \
    if [ -n "$CHROME_DIR" ]; then \
      mkdir -p /app/chrome && \
      cp -r "$CHROME_DIR"/* /app/chrome/ && \
      chmod -R 755 /app/chrome && \
      chmod +x /app/chrome/chrome; \
    fi
ENV CHROME_PATH=/app/chrome/chrome
COPY . .

EXPOSE 3000
CMD ["npm", "start"]
