FROM node:22-bookworm-slim

RUN apt-get update && \
    apt-get install -y python3 python3-venv ffmpeg

RUN python3 -m venv /opt/ytdlp && \
   /opt/ytdlp/bin/pip install -U --pre "yt-dlp[default,curl-cffi]"
ENV PATH="/opt/ytdlp/bin:${PATH}"

WORKDIR /app
COPY . .

CMD ["node", "server.js"]
