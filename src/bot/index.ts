import { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import { parseMorningPlan } from '../llm/morning';
import { reconcileEvening } from '../llm/evening';
import { detectIntent } from '../llm/intent';
import { todayDate } from '../util/date';
import {
  START_MESSAGE,
  handleAddCommand,
  handleDoneCommand,
  handleMoveCommand,
  handleDropCommand,
  handleListCommand,
  handleWeekCommand,
  handleTimeCommand,
  handleRecurCommand,
  routeFreeText,
} from './handlers';

function parseIndexArg(text: string): number | null {
  const match = text.trim().match(/(\d+)/);
  if (!match) return null;
  return parseInt(match[1], 10);
}

function stripCommand(text: string): string {
  return text.replace(/^\/\w+(@\w+)?\s*/, '').trim();
}

export function createBot(token: string): Telegraf {
  const bot = new Telegraf(token);

  bot.start(async (ctx) => {
    await ctx.reply(START_MESSAGE);
  });

  bot.command('list', async (ctx) => {
    await ctx.reply(handleListCommand(ctx.from.id, todayDate()));
  });

  bot.command('week', async (ctx) => {
    await ctx.reply(handleWeekCommand(ctx.from.id, todayDate()));
  });

  bot.command('add', async (ctx) => {
    const text = stripCommand(ctx.message.text);
    if (!text) {
      await ctx.reply('Использование: /add <текст задачи>');
      return;
    }
    await ctx.reply(await handleAddCommand(ctx.from.id, todayDate(), text));
  });

  bot.command('done', async (ctx) => {
    const index = parseIndexArg(stripCommand(ctx.message.text));
    if (index === null) {
      await ctx.reply('Использование: /done <номер>');
      return;
    }
    await ctx.reply(handleDoneCommand(ctx.from.id, todayDate(), index));
  });

  bot.command('move', async (ctx) => {
    const index = parseIndexArg(stripCommand(ctx.message.text));
    if (index === null) {
      await ctx.reply('Использование: /move <номер>');
      return;
    }
    await ctx.reply(handleMoveCommand(ctx.from.id, todayDate(), index));
  });

  bot.command('drop', async (ctx) => {
    const index = parseIndexArg(stripCommand(ctx.message.text));
    if (index === null) {
      await ctx.reply('Использование: /drop <номер>');
      return;
    }
    await ctx.reply(handleDropCommand(ctx.from.id, todayDate(), index));
  });

  bot.command('time', async (ctx) => {
    const hhmm = stripCommand(ctx.message.text);
    await ctx.reply(handleTimeCommand(ctx.from.id, todayDate(), hhmm));
  });

  bot.command('recur', async (ctx) => {
    await ctx.reply(await handleRecurCommand(ctx.from.id, stripCommand(ctx.message.text)));
  });

  bot.command('edit', async (ctx) => {
    await ctx.reply(
      'Просто напиши, что изменить (например: "убери правки по CRM" или "добавь ревью ТЗ") — я разберу и применю.'
    );
  });

  bot.command('plan', async (ctx) => {
    const text = stripCommand(ctx.message.text);
    const reply = await routeFreeText(
      ctx.from.id,
      todayDate(),
      text || ctx.message.text,
      parseMorningPlan,
      reconcileEvening,
      detectIntent
    );
    await ctx.reply(reply);
  });

  bot.on(message('text'), async (ctx) => {
    const preview = ctx.message.text.replace(/\n/g, ' | ').slice(0, 120);
    console.log(`[${new Date().toISOString()}] user=${ctx.from.id} IN: ${preview}`);
    try {
      const reply = await routeFreeText(
        ctx.from.id,
        todayDate(),
        ctx.message.text,
        parseMorningPlan,
        reconcileEvening,
        detectIntent
      );
      console.log(`[${new Date().toISOString()}] user=${ctx.from.id} OUT: ${reply.replace(/\n/g, ' | ').slice(0, 200)}`);
      await ctx.reply(reply);
    } catch (err) {
      console.error(`[${new Date().toISOString()}] user=${ctx.from.id} ERROR:`, err);
      await ctx.reply('Что-то пошло не так при обработке сообщения. Попробуй ещё раз или используй /list.');
    }
  });

  return bot;
}
