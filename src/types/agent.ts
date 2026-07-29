export interface TaskStep {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  description?: string;
  toolCalls?: ToolCall[];
  result?: string;
}

export interface ToolCall {
  id: string;
  toolName: string;
  parameters: Record<string, unknown>;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: string;
  error?: string;
}

export interface PendingToolCall {
  id: string;
  toolName: string;
  parameters: Record<string, unknown>;
  callId: string;
  messageIndex: number;
}

export interface ExecutionStep {
  id: string;
  type: 'plan' | 'tool_call' | 'tool_result' | 'review' | 'error' | 'human_input';
  title: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'waiting';
  detail?: string;
  timestamp: number;
}

export interface AgentState {
  status: 'idle' | 'thinking' | 'executing' | 'done' | 'error';
  plan: TaskStep[];
  currentStep: number;
  messages: Message[];
  toolCalls: ToolCall[];
  toolStreams: ToolStreamEntry[];
  artifacts: Artifact[];
  pendingToolCall?: PendingToolCall;
  executionSteps?: ExecutionStep[];
}

export interface ToolStreamEntry {
  toolCallId: string;
  type: 'stdout' | 'stderr' | 'status';
  data: string;
  timestamp: number;
}

/**
 * Per-message delivery / turn lifecycle (batch-02 conversation-aggregate).
 * Legacy messages may omit this field and remain readable.
 */
export type MessageStatus =
  | 'pending'
  | 'streaming'
  | 'complete'
  | 'error'
  | 'cancelled';

/** Home Normal / Deep preference scoped to a conversation (not global UI). */
export type UserModePreference = 'normal' | 'deep' | null;

/**
 * Message-level learn/UI artifacts for a Turn.
 * Shape is compatible with LearnArtifact; legacy messages may omit artifacts.
 */
export interface MessageTurnArtifact {
  id: string;
  kind: string;
  title?: string;
  content?: string;
  options?: string[];
  selectedIndex?: number | null;
  topic?: string;
  proposal?: string;
  memoryEntries?: string[];
  resources?: unknown[];
  units?: unknown[];
  progressSteps?: Array<{ id: string; label: string; status: string }>;
  /**
   * Structured clarification meta (batch-03/04) — optional for legacy rows.
   * Mirrors LearnClarificationMeta without importing agent types here.
   */
  clarification?: {
    field: 'topic' | 'goal' | 'level' | 'intent_mode';
    selectionMode: 'single' | 'multi';
    allowCustom: boolean;
    optionIds?: string[];
  };
}

/**
 * Conversation-scoped experience snapshot (learn-flow restore on switch/refresh).
 * Persisted on Conversation; draft uses ephemeral store state only.
 */
export interface ConversationExperienceSnapshot {
  stage?: string | null;
  topic?: string;
  proposal?: string;
  experienceMode?: string | null;
  modePreference?: UserModePreference;
  courseId?: string | null;
  sessionId?: string | null;
  outlineUnits?: unknown[];
  artifacts?: MessageTurnArtifact[];
  memoryEntries?: string[];
  calibrationQuestion?: string;
  calibrationOptions?: string[];
  calibrationKind?: 'single_choice' | 'multi_choice' | 'free_text' | null;
  lastRoute?: string | null;
  /** Batch-07: Chat→Calendar constraint collection (conversation-scoped). */
  calendarPlanningActive?: boolean;
  planningConstraints?: Record<string, unknown>;
  calendarPendingConstraintKey?: string | null;
  calendarProposalPreviewId?: string | null;
  /** ISO timestamp when snapshot was taken. */
  updatedAt?: string;
}

/**
 * Typed teach blocks from server (batch-05). Fence markers never required client-side.
 * Kept structural (no import of chat lib) for store serialization.
 */
export interface MessageLearningContentBlock {
  kind: 'summary' | 'key' | 'tip' | 'definition' | 'section' | 'prose';
  title?: string;
  body: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: Date;
  toolName?: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
  thinking?: boolean;
  thinkingStatus?: 'thinking' | 'executing' | 'done' | 'error';
  /**
   * Turn this message belongs to (conversation-scoped).
   * Optional for pre-aggregate history — still readable without it.
   */
  turnId?: string;
  /** Delivery / generation status for this message. */
  status?: MessageStatus;
  /** Turn-bound artifacts (outline, choices, etc.). Empty clears sticky UI. */
  artifacts?: MessageTurnArtifact[];
  /**
   * Server-parsed teach blocks. When present, UI renders these instead of
   * parsing raw ::: fences from content (which should already be fence-free).
   */
  contentBlocks?: MessageLearningContentBlock[];
}

export interface Artifact {
  id: string;
  name: string;
  type: 'file' | 'code' | 'image' | 'data';
  content: string;
  mimeType?: string;
  createdAt: Date;
}

export interface AgentConfig {
  model: string;
  apiKey: string;
  maxSteps: number;
  temperature: number;
  tools: string[];
}
