export type TaskStatus = 'planned' | 'done' | 'partial' | 'moved' | 'dropped';

export type TaskSource =
  | 'morning_plan'
  | 'added_during_day'
  | 'carried_over'
  | 'new_during_review';

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
