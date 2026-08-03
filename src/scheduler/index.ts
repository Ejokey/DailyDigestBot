import cron from 'node-cron';
import { Telegraf } from 'telegraf';
import { getAllConversationStates, getTasksForDate, upsertConversationState } from '../db';
import { currentHHMM } from '../util/date';
import { buildEveningPingMessage } from '../bot/handlers';
import { applyDueRecurringTasks } from '../services/recurringTasks';
import { sendDueReminders } from '../services/reminders';

/**
 * Every minute, checks whether any user's configured evening check-in time
 * has arrived and, if so, pings them and flips their phase to awaiting_evening.
 */
export function startEveningScheduler(bot: Telegraf): void {
  cron.schedule('* * * * *', async () => {
    const nowHHMM = currentHHMM();
    const states = getAllConversationStates();

    for (const state of states) {
      if (state.phase !== 'day_active' || state.eveningCheckinTime !== nowHHMM) continue;

      const tasks = getTasksForDate(state.userId, state.currentDate).filter((t) => t.status !== 'dropped');
      if (tasks.length === 0) continue;

      try {
        await bot.telegram.sendMessage(state.userId, buildEveningPingMessage(tasks));
        upsertConversationState({ ...state, phase: 'awaiting_evening' });
      } catch (err) {
        console.error(`Failed to send evening check-in to user ${state.userId}:`, err);
      }
    }
  });
}

/** Every minute, inserts any due recurring tasks into their owner's plan for today. */
export function startRecurringTasksScheduler(bot: Telegraf): void {
  cron.schedule('* * * * *', async () => {
    try {
      await applyDueRecurringTasks(bot);
    } catch (err) {
      console.error('Failed to apply due recurring tasks:', err);
    }
  });
}

/** Every minute, sends any reminders whose fire time has arrived. */
export function startReminderScheduler(bot: Telegraf): void {
  cron.schedule('* * * * *', async () => {
    try {
      await sendDueReminders(bot);
    } catch (err) {
      console.error('Failed to send due reminders:', err);
    }
  });
}
