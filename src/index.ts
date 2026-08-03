import 'dotenv/config';
import * as path from 'node:path';
import { openDb } from './db';
import { createBot } from './bot';
import { startEveningScheduler, startRecurringTasksScheduler } from './scheduler';

function main(): void {
  const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'bot.sqlite');
  openDb(dbPath);
  console.log(`daily-digest-bot: DB opened at ${dbPath}`);

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.warn(
      'daily-digest-bot: TELEGRAM_BOT_TOKEN is not set — skipping bot.launch(). ' +
        'Set it in .env to actually run the Telegram bot.'
    );
    return;
  }

  const bot = createBot(token);
  startEveningScheduler(bot);
  startRecurringTasksScheduler(bot);
  bot.launch();
  console.log('daily-digest-bot: bot launched');

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

main();
