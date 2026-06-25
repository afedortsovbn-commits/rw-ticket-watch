# Заметки для Claude Code

## Хостинг и деплой (актуально на 2026-06-25)

Сервис задеплоен на VPS **Kamatera** (Ubuntu 24.04, IP `79.108.163.110`), за reverse-proxy **Caddy** с авто-HTTPS. Доступ к серверу — по SSH-ключу.

- Адрес: **https://bilet.fedortsov.pro** (поддомен домена `fedortsov.pro`, регистратор hoster.by).
- Запуск: Docker-контейнер `rw` из этого `Dockerfile` (образ на базе Playwright, внутри Chromium). Сеть docker `web`; наружу порт НЕ пробрасывается — доступ только через Caddy.
- Исходники на сервере: `/opt/rw-ticket-watch`; `.env` с Telegram-секретами; данные/cookies — `/opt/rw-data`. Контейнер с `--restart always`, на сервере включён swap 2 ГБ.
- Обновление: `git pull` → `docker build -t rw-ticket-watch .` → пересоздать контейнер `rw` (та же `docker run` с `--network web --env-file .env -v /opt/rw-data:/app/data`, без `-p`).
- `render.yaml` остался в репо для истории, но **Render больше не используется** — хостинг на собственном сервере.
