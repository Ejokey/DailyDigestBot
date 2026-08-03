import { Telegraf, Markup } from 'telegraf';
import { message } from 'telegraf/filters';
import { parseMorningPlan } from '../llm/morning';
import { reconcileEvening } from '../llm/evening';
import { detectIntent } from '../llm/intent';
import { todayDate } from '../util/date';
import { Task } from '../types';
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
  handleRemindCommand,
  handleBacklogCommand,
  handleTaskActionById,
  getTasksForListView,
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

const MENU = {
  list: '📋 Список',
  week: '📅 Неделя',
  remind: '⏰ Напоминания',
  recur: '🔁 Расписание',
  backlog: '📥 Бэклог',
  help: '❓ Помощь',
};

const MAIN_MENU_KEYBOARD = Markup.keyboard([
  [MENU.list, MENU.week],
  [MENU.remind, MENU.recur],
  [MENU.backlog, MENU.help],
]).resize();

const ACTION_LABEL: Record<'d' | 'm' | 'x', { status: 'done' | 'moved' | 'dropped' }> = {
  d: { status: 'done' },
  m: { status: 'moved' },
  x: { status: 'dropped' },
};

function buildTaskListKeyboard(tasks: Task[]) {
  const rows = tasks.map((t, i) => {
    const n = i + 1;
    return [
      Markup.button.callback(`${n} ✅`, `d:${t.id}`),
      Markup.button.callback(`${n} ⏳`, `m:${t.id}`),
      Markup.button.callback(`${n} ❌`, `x:${t.id}`),
    ];
  });
  return Markup.inlineKeyboard(rows);
}

async function replyWithTaskList(ctx: { from?: { id: number }; reply: Function }, userId: number, date: string): Promise<void> {
  const text = handleListCommand(userId, date);
  const tasks = getTasksForListView(userId, date);
  if (tasks.length === 0) {
    await ctx.reply(text);
    return;
  }
  await ctx.reply(text, buildTaskListKeyboard(tasks));
}

export function createBot(token: string): Telegraf {
  const bot = new Telegraf(token);

  bot.start(async (ctx) => {
    await ctx.reply(START_MESSAGE, MAIN_MENU_KEYBOARD);
  });

  bot.command('list', async (ctx) => {
    await replyWithTaskList(ctx, ctx.from.id, todayDate());
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

  bot.command('remind', async (ctx) => {
    await ctx.reply(handleRemindCommand(ctx.from.id, stripCommand(ctx.message.text)));
  });

  bot.command('backlog', async (ctx) => {
    await ctx.reply(await handleBacklogCommand(ctx.from.id, todayDate(), stripCommand(ctx.message.text)));
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

  // Tapping a ✅/⏳/❌ button under a /list message applies that status change
  // by task id (not position — the list may have changed since the buttons
  // were rendered) and refreshes the same message in place.
  bot.action(/^(d|m|x):(.+)$/, async (ctx) => {
    const letter = ctx.match[1] as 'd' | 'm' | 'x';
    const taskId = ctx.match[2];
    const userId = ctx.from.id;
    const date = todayDate();
    const resultText = handleTaskActionById(userId, date, taskId, ACTION_LABEL[letter].status);
    await ctx.answerCbQuery(resultText);

    const remaining = getTasksForListView(userId, date);
    const listText = handleListCommand(userId, date);
    try {
      if (remaining.length === 0) {
        await ctx.editMessageText(listText);
      } else {
        await ctx.editMessageText(listText, { reply_markup: buildTaskListKeyboard(remaining).reply_markup });
      }
    } catch (err) {
      console.error('Failed to refresh task list message after button tap:', err);
    }
  });

  bot.on(message('text'), async (ctx) => {
    const preview = ctx.message.text.replace(/\n/g, ' | ').slice(0, 120);
    console.log(`[${new Date().toISOString()}] user=${ctx.from.id} IN: ${preview}`);

    // Persistent menu buttons send their label as plain text — intercept those
    // before free-text routing so they always map to the same action, regardless
    // of what the intent-detection LLM might make of the label text.
    const userId = ctx.from.id;
    const date = todayDate();
    switch (ctx.message.text) {
      case MENU.list:
        await replyWithTaskList(ctx, userId, date);
        return;
      case MENU.week:
        await ctx.reply(handleWeekCommand(userId, date));
        return;
      case MENU.remind:
        await ctx.reply(handleRemindCommand(userId, 'list'));
        return;
      case MENU.recur:
        await ctx.reply(await handleRecurCommand(userId, 'list'));
        return;
      case MENU.backlog:
        await ctx.reply(await handleBacklogCommand(userId, date, 'list'));
        return;
      case MENU.help:
        await ctx.reply(START_MESSAGE, MAIN_MENU_KEYBOARD);
        return;
      default:
        break;
    }

    try {
      const reply = await routeFreeText(userId, date, ctx.message.text, parseMorningPlan, reconcileEvening, detectIntent);
      console.log(`[${new Date().toISOString()}] user=${ctx.from.id} OUT: ${reply.replace(/\n/g, ' | ').slice(0, 200)}`);
      await ctx.reply(reply);
    } catch (err) {
      console.error(`[${new Date().toISOString()}] user=${ctx.from.id} ERROR:`, err);
      await ctx.reply('Что-то пошло не так при обработке сообщения. Попробуй ещё раз или используй /list.');
    }
  });

  return bot;
}
