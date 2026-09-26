FROM node:20-alpine
WORKDIR /app

# Render auto-forwards each dashboard env var as a same-named build arg for
# Dockerfile deploys, but ONLY into vars explicitly declared here with ARG --
# without this, Vite's build step below never sees it, no matter how
# correctly it's set in Render's dashboard (build-time vs runtime env is a
# real, easy-to-miss distinction for Docker-based services specifically).
ARG VITE_GOOGLE_CLIENT_ID
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID
ARG VITE_APP_URL
ENV VITE_APP_URL=$VITE_APP_URL

COPY . .
RUN npm install
RUN npm run build

# Set only after the build: npm install skips devDependencies under
# NODE_ENV=production, and Vite (a client devDependency) is needed above.
# From here on the server runs as production: secure cookies, HSTS, the
# session-secret check in server/config.js, no test or dev seams.
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "start"]
