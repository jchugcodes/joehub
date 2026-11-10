export interface AccountBalance {
  id: string;
  name: string;
  account_type: string;
  institution: string | null;
  balance_cents: number;
}

export interface TransactionRow {
  id: string;
  date: string;
  amount_cents: number;
  payee: string | null;
  memo: string | null;
  account_name: string;
  category_name: string | null;
}

export interface ApplicationRow {
  id: string;
  role_title: string;
  status: string;
  applied_on: string | null;
  raw_company: string | null;
  raw_contact: string | null;
  raw_status: string | null;
  raw_source: string | null;
  notes: string | null;
  company_id: string | null;
  company_name: string | null;
}

export interface StatusCount {
  status: string;
  total: number;
}

export interface JournalEntry {
  id: string;
  entry_date: string;
  title: string | null;
  body: string;
  mood: string | null;
}

export interface EventRow {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  location: string | null;
  notes: string | null;
}

export interface Device {
  id: string;
  label: string;
  created_at: string;
  expires_at: string;
  revoked: boolean;
}

export interface LoginResult {
  device_id: string;
}

export interface GroceryItem {
  id: string;
  name: string;
  quantity?: string;
  section?: string;
  notes?: string;
  checked: boolean;
  createdAt: number;
  updatedAt: number;
  checkedAt?: number;
}

export interface Task {
  id: string;
  title: string;
  notes?: string;
  dueDate?: string;
  priority?: "High" | "Medium" | "Low";
  status: "To do" | "Doing" | "Blocked" | "Done";
  project?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export interface FixtureFile {
  accounts: AccountBalance[];
  transactions: TransactionRow[];
  applications: ApplicationRow[];
  statuses: StatusCount[];
  entries: JournalEntry[];
  events: EventRow[];
}
