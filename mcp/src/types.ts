export const CAPABILITIES = {
  core: "urn:ietf:params:jmap:core",
  mail: "urn:ietf:params:jmap:mail",
  submission: "urn:ietf:params:jmap:submission",
  calendars: "urn:ietf:params:jmap:calendars",
  calendarsParse: "urn:ietf:params:jmap:calendars:parse",
} as const;

export type Scope = "mail.read" | "mail.send" | "mail.draft" | "calendar.read" | "calendar.write";

export const ALL_SCOPES: Scope[] = ["mail.read", "mail.send", "mail.draft", "calendar.read", "calendar.write"];

export type SendMode = "draft-only" | "send-allowed";

export interface JmapAccount {
  name: string;
  isPersonal: boolean;
  isReadOnly: boolean;
  accountCapabilities: Record<string, unknown>;
}

export interface JmapSession {
  capabilities: Record<string, unknown>;
  accounts: Record<string, JmapAccount>;
  primaryAccounts: Record<string, string>;
  username: string;
  apiUrl: string;
  downloadUrl: string;
  uploadUrl: string;
  eventSourceUrl?: string;
  state: string;
}

export type JmapMethodCall = [string, Record<string, unknown>, string];
export type JmapMethodResponse = [string, Record<string, unknown>, string];

export interface JmapResponse {
  methodResponses: JmapMethodResponse[];
  sessionState?: string;
}

export interface Mailbox {
  id: string;
  name: string;
  parentId?: string | null;
  role?: string | null;
  sortOrder?: number;
  totalEmails?: number;
  unreadEmails?: number;
}

export interface EmailAddress {
  name?: string;
  email?: string;
}

export interface EmailBodyPart {
  partId?: string;
  blobId?: string;
  type?: string;
  name?: string;
  size?: number;
}

export interface Email {
  id: string;
  blobId?: string;
  threadId?: string;
  mailboxIds: Record<string, boolean>;
  keywords: Record<string, boolean>;
  receivedAt: string;
  sentAt?: string;
  from?: EmailAddress[];
  to?: EmailAddress[];
  cc?: EmailAddress[];
  bcc?: EmailAddress[];
  subject?: string;
  preview?: string;
  hasAttachment?: boolean;
  messageId?: string[];
  inReplyTo?: string[];
  references?: string[];
  textBody?: EmailBodyPart[];
  htmlBody?: EmailBodyPart[];
  attachments?: EmailBodyPart[];
  bodyValues?: Record<string, { value: string; isTruncated?: boolean }>;
}

export interface Identity {
  id: string;
  name: string;
  email: string;
}

export interface Calendar {
  id: string;
  name: string;
  color?: string;
  sortOrder?: number;
  myRights?: Record<string, boolean>;
}

export type ParticipationStatus = "needs-action" | "accepted" | "tentative" | "declined";

export interface EventParticipant {
  "@type"?: string;
  name?: string;
  email?: string;
  calendarAddress?: string;
  kind?: string;
  roles?: Record<string, boolean>;
  participationStatus?: ParticipationStatus;
  expectReply?: boolean;
}

export interface CalendarEvent {
  id: string;
  uid?: string;
  title?: string;
  description?: string;
  start: string;
  duration?: string;
  timeZone?: string;
  showWithoutTime?: boolean;
  calendarIds: Record<string, boolean>;
  participants?: Record<string, EventParticipant>;
  organizerCalendarAddress?: string;
  locations?: Record<string, { name?: string; uri?: string }>;
  recurrenceRule?: Record<string, unknown>;
  recurrenceRules?: Array<Record<string, unknown>>;
  recurrenceOverrides?: Record<string, Record<string, unknown>>;
  status?: string;
  freeBusyStatus?: string;
  sequence?: number;
  updated?: string;
}

export type RecurrenceFrequency = "daily" | "weekly" | "monthly" | "yearly";

export interface RecurrenceInput {
  frequency: RecurrenceFrequency;
  interval?: number;
  until?: string;
  count?: number;
  byDay?: string[];
}

export interface EventOccurrenceInput {
  start: string;
  end?: string;
  title?: string;
  location?: string;
}

export interface ParticipantIdentity {
  id: string;
  name: string;
  calendarAddress: string;
  isDefault?: boolean;
}

export interface ToolErrorBody {
  code: string;
  message: string;
  jmapMethod?: string;
}
