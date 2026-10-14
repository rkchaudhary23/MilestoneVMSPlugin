# Milestone XProtect plugin for Access360 (spec §10.2).
# Build:  docker build -t vms-milestone:1.0.0 .
# Run:    docker run -p 4505:4505 vms-milestone:1.0.0   ->  http://localhost:4505/vms/milestone/

# Stage 1: build the Angular app
FROM node:18-alpine AS build-stage
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build -- --configuration production --base-href /vms/milestone/

# Stage 2: serve it with Nginx as a non-root user (spec §11.2)
FROM nginxinc/nginx-unprivileged:1.27-alpine
ENV PORT=4505
COPY docker/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY docker/40-runtime-config.sh /docker-entrypoint.d/40-runtime-config.sh
COPY --from=build-stage /app/dist/milestone/browser /usr/share/nginx/html/vms/milestone
USER root
RUN chmod 0755 /docker-entrypoint.d/40-runtime-config.sh \
 && chown -R nginx:nginx /usr/share/nginx/html/vms/milestone/assets
USER nginx
EXPOSE 4505
