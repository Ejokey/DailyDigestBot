# Daily Digest Bot

Telegram-бот для ежедневного управления задачами: утренний план → дневные обновления
свободным текстом → вечерний чек-ин с reconciliation → перенос незакрытых задач →
недельный дайджест.

## Стек

- Node.js / TypeScript
- Telegraf (Telegram Bot API)
- `node:sqlite` (встроенный SQLite, без нативной сборки)
- LLM: Groq (`llama-3.3-70b-versatile`, бесплатный тир) по умолчанию;
  Ollama (локально) и Anthropic — доступны как альтернативные провайдеры

## Локальный запуск

```bash
npm install
cp .env.example .env   # заполнить TELEGRAM_BOT_TOKEN и GROQ_API_KEY
npm run build
npm start
```

## Переменные окружения

См. [`.env.example`](.env.example). Обязательные для запуска:

- `TELEGRAM_BOT_TOKEN` — токен от [@BotFather](https://t.me/BotFather)
- `LLM_PROVIDER` — `groq` (по умолчанию), `ollama` или `anthropic`
- `GROQ_API_KEY` — если `LLM_PROVIDER=groq` ([console.groq.com](https://console.groq.com))

## Деплой (Railway)

1. Залогиниться на [railway.app](https://railway.app) через GitHub
2. New Project → Deploy from GitHub repo → выбрать этот репозиторий
3. Railway автоматически определит Node.js, выполнит `npm install` и `npm run build`
   (см. `build`-скрипт в `package.json`), затем `npm start`
4. В Settings → Variables добавить переменные из `.env.example` (реальные значения)
5. **Важно про хранение данных**: SQLite-файл (`DB_PATH`, по умолчанию `./data/bot.sqlite`)
   живёт в контейнере и **обнуляется при каждом передеплое**, если не подключить
   [Railway Volume](https://docs.railway.app/reference/volumes) на путь `/app/data`.
   Для постоянного хранения задач — обязательно добавить volume.

## Команды бота

`/start` `/add` `/done` `/move` `/drop` `/list` `/week` `/time` `/edit` —
плюс свободный текст (LLM сам определяет намерение: план, добавление, статус, отчёт, вопрос).
