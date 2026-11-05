export type KidTask = {
  id: string;
  name: string;
  points: number;
  done: boolean;
};

export type CatalogTask = {
  id: string;
  name: string;
  points: number;
};

export type RewardItem = {
  id: string;
  name: string;
  cost: number;
};

export type KidState = {
  balance: number;
  timezone: string;
  localDate: string;
  childName: string;
  tasks: KidTask[];
  rewards: RewardItem[];
};

export type PendingItem = {
  id: string;
  name: string;
  cost: number;
  time: string;
};

export type LogItem = {
  text: string;
  time: string;
};

export type ParentState = {
  balance: number;
  timezone: string;
  familyCode: string;
  familyName: string;
  parentEmail: string;
  localDate: string;
  pending: PendingItem[];
  tasks: CatalogTask[];
  rewards: RewardItem[];
  logs: LogItem[];
};

export type SessionRole = 'parent' | 'child';
