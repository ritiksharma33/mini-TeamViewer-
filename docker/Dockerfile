FROM debian:bullseye-slim

# Install Chromium and dependencies
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    wget \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Create a non-root user for security
RUN groupadd -r chrome && useradd -r -g chrome -G audio,video chrome \
    && mkdir -p /home/chrome && chown -R chrome:chrome /home/chrome

USER chrome

EXPOSE 9222

# Launch Chromium in headless mode with remote debugging enabled
# --no-sandbox:             required inside Docker (no kernel namespace isolation)
# --disable-setuid-sandbox: companion flag to --no-sandbox
# --disable-dev-shm-usage:  Docker /dev/shm is 64MB by default; Chromium crashes without this
# --remote-debugging-port:  exposes CDP (Chrome DevTools Protocol) on port 9222
# --remote-debugging-address=0.0.0.0: makes CDP reachable from outside the container
CMD ["chromium", \
     "--no-sandbox", \
     "--disable-setuid-sandbox", \
     "--disable-dev-shm-usage", \
     "--disable-gpu", \
     "--headless=new", \
     "--remote-debugging-port=9222", \
     "--remote-debugging-address=0.0.0.0", \
     "--window-size=1280,720", \
     "--user-data-dir=/tmp/chrome-data", \
     "about:blank"]
