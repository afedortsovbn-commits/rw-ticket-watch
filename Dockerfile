# Образ Playwright уже содержит Chromium и системные библиотеки для него.
# Версия тега должна совпадать с playwright в package.json.
FROM mcr.microsoft.com/playwright:v1.61.0-jammy

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=4174

EXPOSE 4174

CMD ["npm", "start"]
