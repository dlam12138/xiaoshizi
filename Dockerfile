# 阶段 1: 构建 UPC 生产静态资源
FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Vite injects VITE_* at build time. Pass the UPC project values as build args;
# without them the static build deliberately shows the configuration screen.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_CACHE_API_ENABLED=false
ARG VITE_API_BASE_URL=/api
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY \
    VITE_CACHE_API_ENABLED=$VITE_CACHE_API_ENABLED \
    VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build

# 阶段 2: 使用 Nginx 托管静态 SPA
FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
