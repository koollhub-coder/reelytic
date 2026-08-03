FROM node:20-alpine
WORKDIR /app

# Render auto-forwards each dashboard env var as a same-named build arg for
# Dockerfile deploys, but ONLY into vars explicitly declared here with ARG --
# without this, Vite's build step below never sees it, no matter how
# correctly it's set in Render's dashboard (build-time vs runtime env is a
# real, easy-to-miss distinction for Docker-based services specifically).
ARG VITE_GOOGLE_CLIENT_ID
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID

COPY . .
RUN npm install
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
