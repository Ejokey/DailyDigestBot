import { Telegraf } from 'telegraf';
import { getDueReminders, markReminderFired } from '../db';

/** Every minute, sends any reminder whose fireAt has arrived and marks it fired. */
export async function sendDueReminders(bot: Telegraf): Promise<void> {
  const due = getDueReminders(new Date().toISOString());
  for (const reminder of due) {
    try {
      await bot.telegram.sendMessage(reminder.userId, `Напоминание: ${reminder.text}`);
    } catch (err) {
      console.error(`Failed to send reminder to user ${reminder.userId}:`, err);
    } finally {
      markReminderFired(reminder.id);
    }
  }
}
