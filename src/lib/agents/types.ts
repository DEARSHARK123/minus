/**
 * Multi-agent executor types — learn artifacts + desktop tool events.
 */

export type AgentRoute =
  | 'chat'
  | 'learn_confirm'
  | 'learn_memory'
  | 'learn_calibrate'
  | 'learn_resources'
  | 'learn_outline'
  | 'learn_progress'
  | 'desktop';

export type LearnArtifactKind =
  | 'confirm_gate'
  | 'memory_card'
  | 'single_choice'
  | 'multi_choice'
  | 'free_text'
  | 'resource_list'
  | 'outline_card'
  | 'progress_update'
  | 'plain_assistant'
  | 'calendar_constraint';

export type DesktopEventKind =
  | 'tool_call'
  | 'tool_result'
  | 'pending_tool_confirm'
  | 'thinking';

export type ArtifactKind = LearnArtifactKind | DesktopEventKind;

export interface ResourceItem {
  title: string;
  reason: string;
  source: 'llm';
}

export interface OutlineUnitArtifact {
  title: string;
  knowledgePoints: string[];
  description?: string;
  estimatedMinutes?: number;
}

/**
 * Structured clarification attached to single/multi/free_text artifacts (batch-03).
 * Mirrors ClarificationSpec without importing Zod at the type boundary.
 */
export interface LearnClarificationMeta {
  field: 'topic' | 'goal' | 'level' | 'intent_mode';
  selectionMode: 'single' | 'multi';
  allowCustom: boolean;
  optionIds?: string[];
}

export interface LearnArtifact {
  id: string;
  kind: LearnArtifactKind;
  /** Human-facing title */
  title?: string;
  /** Body / question / assistant prose */
  content?: string;
  /** For choice cards */
  options?: string[];
  /** Pre-selected or default */
  selectedIndex?: number | null;
  resources?: ResourceItem[];
  units?: OutlineUnitArtifact[];
  /** Progress narrator steps / labels */
  progressSteps?: Array<{ id: string; label: string; status: 'pending' | 'active' | 'done' }>;
  /** Topic hint from intent */
  topic?: string;
  /** Original user proposal text */
  proposal?: string;
  /** Memory recall lines */
  memoryEntries?: string[];
  /** Batch-03 structured clarify metadata for choice/free_text cards. */
  clarification?: LearnClarificationMeta;
}

export interface DesktopEvent {
  id: string;
  kind: DesktopEventKind;
  content?: string;
  toolName?: string;
  toolCallId?: string;
  parameters?: Record<string, unknown>;
  result?: string;
  /**
   * Unified HITL reason:
   * trust_elevation | dangerous_tool | workspace_write | network_access |
   * package_install | publish_external | delete_or_overwrite | human_question
   */
  confirmReason?: string;
  /** Server pause token for single-tool resume */
  resumeToken?: string;
  reasonLabel?: string;
  riskLabel?: string;
  whatChanges?: string;
}

/** Client-side pending confirm card (Home Desktop HITL). */
export interface PendingToolConfirm {
  toolCallId: string;
  toolName: string;
  parameters: Record<string, unknown>;
  confirmReason: string;
  reasonLabel?: string;
  riskLabel?: string;
  whatChanges?: string;
  content?: string;
  resumeToken: string;
}

export type OrchestratorAction =
  | 'intent'
  | 'confirm_learn'
  | 'reject_learn'
  | 'continue_memory'
  | 'select_calibration'
  | 'advance_resources'
  | 'request_outline'
  | 'request_progress'
  | 'desktop'
  | 'chat';

export interface OrchestratorContext {
  stage?: string;
  topic?: string;
  proposal?: string;
  memoryEntries?: string[];
  calibrationSelected?: number | null;
  calibrationSelectedIndices?: number[];
  calibrationAnswer?: string;
  calibrationKind?: 'single_choice' | 'multi_choice' | 'free_text' | null;
  resources?: ResourceItem[];
  outlineUnits?: OutlineUnitArtifact[];
  /** User wants trust mode; server still requires confirm unless trustConfirmed */
  requestedExecutionMode?: 'sandbox' | 'trust';
  trustConfirmed?: boolean;
  /** UX02: visible page / surface key (chat|course|calendar|library|…). */
  surface?: string;
  /** UX02: explicit Normal / Deep preference from UI. */
  userModePreference?: 'normal' | 'deep' | null;
  /** UX02: known learning goal when already supplied. */
  knownGoal?: string;
  /** UX02: known level / calibration when already supplied. */
  knownLevel?: string;
  /** UX02: force-skip flags from prior ExperiencePlan (Deep path). */
  skipMemory?: boolean;
  skipCalibration?: boolean;
  skipResources?: boolean;
  /** UX02: experience mode from prior plan (deep_planning, normal, …). */
  experienceMode?: string;
  /** UX02: steps already skipped (e.g. resources, memory). */
  skippedSteps?: string[];
}

export interface OrchestratorRequest {
  message: string;
  action?: OrchestratorAction;
  providerId?: string;
  context?: OrchestratorContext;
  chatHistory?: Array<{ role: string; content: string }>;
  systemPrompt?: string;
}

export interface OrchestratorResult {
  route: AgentRoute;
  artifacts: LearnArtifact[];
  desktopEvents?: DesktopEvent[];
  /** When route=chat, client should stream /api/chat */
  streamChat?: boolean;
  /** When route=desktop, client should call /api/agent (SSE) */
  runDesktop?: boolean;
  /** Suggested next learn stage for client store */
  nextStage?: string;
  topic?: string;
  proposal?: string;
  error?: string;
  /**
   * Public ExperiencePlan meta for client routing (batch-05).
   * `internalReason` is server audit-only and must never appear here.
   */
  experiencePlan?: {
    mode: string;
    requiredSteps: string[];
    optionalSteps: string[];
    skippedSteps: string[];
    surface: string;
    nextAction: string;
    commitPolicy: string;
    confidence: number;
    clarifyQuestionZh?: string;
    /** Structured one-field clarification (batch-03). */
    clarificationSpec?: {
      field: 'topic' | 'goal' | 'level' | 'intent_mode';
      question: string;
      options: Array<{ id: string; label: string }>;
      selectionMode: 'single' | 'multi';
      allowCustom: boolean;
    };
    topic?: string;
    skillScene?: string;
  };
}

export function newArtifactId(prefix = 'art'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
