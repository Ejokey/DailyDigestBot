export type TaskStatus = 'planned' | 'done' | 'partial' | 'moved' | 'dropped';

export type TaskSource =
  | 'morning_plan'
  | 'added_during_day'
  | 'carried_over'
  | 'new_during_review'
  | 'recurring'
  | 'backlog';

export type TaskCategory = 'work' | 'personal' | 'other';

export interface Task {
  id: string;
  userId: number;
  text: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  date: string;
  originalDate?: string;
  movedCount: number;
  source: TaskSource;
  category: TaskCategory;
}

export interface DailyState {
  userId: number;
  date: string;
  morningInputRaw: string | null;
  eveningInputRaw: string | null;
  morningProcessed: boolean;
  eveningProcessed: boolean;
}

export type ConversationPhase =
  | 'awaiting_morning'
  | 'day_active'
  | 'awaiting_evening'
  | 'evening_done';

export interface ConversationState {
  userId: number;
  currentDate: string;
  phase: ConversationPhase;
  eveningCheckinTime: string;
}

/** schedule is 'daily' or a UTC weekday index as a string ('0'=Sunday .. '6'=Saturday) */
export interface RecurringTask {
  id: string;
  userId: number;
  text: string;
  category: TaskCategory;
  schedule: string;
  time: string;
  createdAt: string;
}

export interface Reminder {
  id: string;
  userId: number;
  text: string;
  fireAt: string;
  fired: boolean;
  createdAt: string;
}

export interface BacklogItem {
  id: string;
  userId: number;
  text: string;
  category: TaskCategory;
  createdAt: string;
}
