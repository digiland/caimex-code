# Static file server for the Caimex Code installer + macOS binaries.
# Build context expects ./public to already be populated (run ./stage.sh first).
FROM nginx:alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY public/ /usr/share/nginx/html/

EXPOSE 80
