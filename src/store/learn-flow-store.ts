import { create } from 'zustand';
import { useSettingsStore } from '@/store/settings-store';
import type {
  DesktopEvent,
  LearnArtifact,
  OrchestratorAction,
  OrchestratorResult,
  OutlineUnitArtifact,
  ResourceItem,
} from '@/lib/agents/types';
import {
  decideMidFlowRoute,
  normalizeLearnStage,
  type LearnFlowStage,
} from '@/lib/agents/learn-state-machine';
import {
  LEARN_FLOW_DRAFT_KEY,
  isStaleConversationWrite,
  learnFlowSliceKey,
  applyTurnArtifacts,
} from '@/lib/chat/conversation-aggregate';
import type {
  ConversationExperienceSnapshot,
  MessageTurnArtifact,
  UserModePreference,
} from '@/types/agent';
import { gateOutboundCopy, gateArtifactsCopy } from '@/lib/ui/outbound-copy-gate';

export type { LearnFlowStage };

/** Per-conversation learn-flow slice (never shared across conversation ids). */
export type LearnFlowSlice = {
  stage: LearnFlowStage;
  proposal: string;
  topic: string;
  memoryEntries: string[];
  calibrationQuestion: string;
  calibrationOptions: string[];
  calibrationSelected: number | null;
  calibrationSelectedIndices: number[];
  calibrationKind: 'single_choice' | 'multi_choice' | 'free_text' | null;
  resources: ResourceItem[];
  outlineUnits: OutlineUnitArtifact[];
  artifacts: LearnArtifact[];
  desktopEvents: DesktopEvent[];
  courseId: string | null;
  sessionId: string | null;
  loading: boolean;
  error: string | null;
  lastRoute: string | null;
  streamChat: boolean;
  runDesktop: boolean;
  experienceMode: string | null;
  modePreference: UserModePreference;
  midFlowHint: string | null;
  pendingDesktopMessage: string | null;
  desktopResume: { trustConfirmed: boolean; nonce: number } | null;
  /** In-flight turn id for artifact binding / race guards. */
  currentTurnId: string | null;
  /** Monotonic generation for in-flight orchestrator calls on this slice. */
  requestGeneration: number;
};

const initialSlice = (): LearnFlowSlice => ({
  stage: 'idle',
  proposal: '',
  topic: '',
  memoryEntries: [],
  calibrationQuestion: '',
  calibrationOptions: [],
  calibrationSelected: null,
  calibrationSelectedIndices: [],
  calibrationKind: null,
  resources: [],
  outlineUnits: [],
  artifacts: [],
  desktopEvents: [],
  courseId: null,
  sessionId: null,
  loading: false,
  error: null,
  lastRoute: null,
  streamChat: false,
  runDesktop: false,
  experienceMode: null,
  modePreference: null,
  midFlowHint: null,
  pendingDesktopMessage: null,
  desktopResume: null,
  currentTurnId: null,
  requestGeneration: 0,
});

function sliceFromSnapshot(
  snap: ConversationExperienceSnapshot | null | undefined,
): LearnFlowSlice {
  const base = initialSlice();
  if (!snap) return base;
  return {
    ...base,
    stage: normalizeLearnStage(snap.stage),
    topic: snap.topic || '',
    proposal: snap.proposal || '',
    experienceMode: snap.experienceMode ?? null,
    modePreference: snap.modePreference ?? null,
    courseId: snap.courseId ?? null,
    sessionId: snap.sessionId ?? null,
    outlineUnits: Array.isArray(snap.outlineUnits)
      ? (snap.outlineUnits as OutlineUnitArtifact[])
      : [],
    artifacts: Array.isArray(snap.artifacts)
      ? (snap.artifacts as LearnArtifact[])
      : [],
    memoryEntries: Array.isArray(snap.memoryEntries) ? snap.memoryEntries : [],
    calibrationQuestion: snap.calibrationQuestion || '',
    calibrationOptions: Array.isArray(snap.calibrationOptions)
      ? snap.calibrationOptions
      : [],
    calibrationKind: snap.calibrationKind ?? null,
    lastRoute: snap.lastRoute ?? null,
  };
}

function snapshotFromSlice(slice: LearnFlowSlice): ConversationExperienceSnapshot {
  return {
    stage: slice.stage,
    topic: slice.topic,
    proposal: slice.proposal,
    experienceMode: slice.experienceMode,
    modePreference: slice.modePreference,
    courseId: slice.courseId,
    sessionId: slice.sessionId,
    outlineUnits: slice.outlineUnits,
    artifacts: slice.artifacts as MessageTurnArtifact[],
    memoryEntries: slice.memoryEntries,
    calibrationQuestion: slice.calibrationQuestion,
    calibrationOptions: slice.calibrationOptions,
    calibrationKind: slice.calibrationKind,
    lastRoute: slice.lastRoute,
    updatedAt: new Date().toISOString(),
  };
}

function mergeFromArtifacts(
  artifacts: LearnArtifact[],
  patch: Partial<LearnFlowSlice>,
): Partial<LearnFlowSlice> {
  const next = { ...patch };
  for (const a of artifacts) {
    if (a.topic) next.topic = a.topic;
    if (a.proposal) next.proposal = a.proposal;
    if (a.kind === 'memory_card') {
      next.memoryEntries =
        a.memoryEntries ??
        (a.content && a.content !== '暂无长期记忆'
          ? a.content.split('\n').filter(Boolean)
          : []);
    }
    if (
      a.kind === 'single_choice' ||
      a.kind === 'multi_choice' ||
      a.kind === 'free_text'
    ) {
      next.calibrationQuestion = a.content || '';
      next.calibrationOptions = a.options || [];
      next.calibrationKind = a.kind;
      next.calibrationSelected = null;
      next.calibrationSelectedIndices = [];
    }
    if (a.kind === 'resource_list' && a.resources) {
      next.resources = a.resources;
    }
    if (a.kind === 'outline_card' && a.units) {
      next.outlineUnits = a.units;
    }
  }
  return next;
}

interface LearnFlowStore extends LearnFlowSlice {
  /**
   * Conversation id currently bound to the denormalized active fields.
   * `null` = draft (`LEARN_FLOW_DRAFT_KEY`).
   */
  boundConversationId: string | null;
  /** conversationId → slice (includes draft key). */
  slices: Record<string, LearnFlowSlice>;

  bindConversation: (
    conversationId: string | null,
    opts?: {
      snapshot?: ConversationExperienceSnapshot | null;
      createIfMissing?: boolean;
      /** When binding draft, force a fresh empty slice (open new chat). */
      resetDraft?: boolean;
      /** Replace existing slice from snapshot (rehydrate only). */
      forceSnapshot?: boolean;
    },
  ) => void;
  promoteDraftToConversation: (conversationId: string) => void;
  dropConversationSlice: (conversationId: string) => void;
  getActiveSnapshot: () => ConversationExperienceSnapshot;
  setModePreference: (mode: UserModePreference) => void;
  setCurrentTurnId: (turnId: string | null) => void;
  resetActiveSlice: () => void;

  applyOrchestratorResult: (
    result: OrchestratorResult,
    opts?: {
      expectedConversationId?: string | null;
      expectedGeneration?: number;
    },
  ) => boolean;
  callOrchestrator: (
    message: string,
    action: OrchestratorAction,
    providerId: string,
    extra?: {
      chatHistory?: Array<{ role: string; content: string }>;
      calibrationAnswer?: string;
      requestedExecutionMode?: 'sandbox' | 'trust';
      trustConfirmed?: boolean;
      userModePreference?: 'normal' | 'deep' | null;
      surface?: string;
      knownGoal?: string;
      knownLevel?: string;
    },
  ) => Promise<OrchestratorResult>;
  considerUserMessage: (
    text: string,
    providerId: string,
    chatHistory?: Array<{ role: string; content: string }>,
    requestedExecutionMode?: 'sandbox' | 'trust',
    opts?: {
      userModePreference?: 'normal' | 'deep' | null;
      surface?: string;
    },
  ) => Promise<OrchestratorResult>;
  confirmIntent: (providerId: string) => Promise<void>;
  rejectIntent: (providerId: string) => Promise<void>;
  continueFromMemory: (providerId: string) => Promise<void>;
  selectCalibration: (index: number, providerId: string) => Promise<void>;
  toggleCalibrationOption: (index: number) => void;
  submitMultiCalibration: (providerId: string) => Promise<void>;
  advanceFromResources: (providerId: string) => Promise<void>;
  confirmTrustElevation: () => void;
  rejectTrustElevation: () => void;
  clearDesktopResume: () => void;
  setCourseAndSession: (courseId: string, sessionId: string) => void;
  setOutlineUnitsPreview: (units: OutlineUnitArtifact[]) => void;
  setSessionPhaseStage: (stage: LearnFlowStage) => void;
  pushDesktopEvent: (event: DesktopEvent) => void;
  reset: () => void;
}

function projectActive(
  boundConversationId: string | null,
  slices: Record<string, LearnFlowSlice>,
): LearnFlowSlice {
  const key = learnFlowSliceKey(boundConversationId);
  return slices[key] ?? initialSlice();
}

function writeActive(
  state: {
    boundConversationId: string | null;
    slices: Record<string, LearnFlowSlice>;
  },
  patch: Partial<LearnFlowSlice>,
): {
  boundConversationId: string | null;
  slices: Record<string, LearnFlowSlice>;
} & LearnFlowSlice {
  const key = learnFlowSliceKey(state.boundConversationId);
  const prev = state.slices[key] ?? initialSlice();
  const nextSlice = { ...prev, ...patch };
  const slices = { ...state.slices, [key]: nextSlice };
  return {
    boundConversationId: state.boundConversationId,
    slices,
    ...nextSlice,
  };
}

export const useLearnFlowStore = create<LearnFlowStore>((set, get) => {
  const draft = initialSlice();
  return {
    boundConversationId: null,
    slices: { [LEARN_FLOW_DRAFT_KEY]: draft },
    ...draft,

    bindConversation: (conversationId, opts) => {
      const state = get();
      const nextKey = learnFlowSliceKey(conversationId);
      const slices = { ...state.slices };

      // Persist leaving slice is already in slices; optionally reset draft.
      if (conversationId == null && opts?.resetDraft) {
        slices[LEARN_FLOW_DRAFT_KEY] = initialSlice();
      } else if (opts?.forceSnapshot && opts.snapshot) {
        // Rehydrate path: trust persisted snapshot.
        slices[nextKey] = sliceFromSnapshot(opts.snapshot);
      } else if (!slices[nextKey]) {
        // First bind for this id: seed from snapshot or empty.
        if (opts?.snapshot) {
          slices[nextKey] = sliceFromSnapshot(opts.snapshot);
        } else if (opts?.createIfMissing !== false) {
          slices[nextKey] = initialSlice();
        }
      }
      // else: keep in-memory slice (A→B→A isolation restore)

      const active = slices[nextKey] ?? initialSlice();
      if (!slices[nextKey]) slices[nextKey] = active;

      set({
        boundConversationId: conversationId,
        slices,
        ...active,
      });
    },

    promoteDraftToConversation: (conversationId) => {
      const state = get();
      const draftSlice =
        state.slices[LEARN_FLOW_DRAFT_KEY] ?? projectActive(null, state.slices);
      const slices = {
        ...state.slices,
        [conversationId]: { ...draftSlice },
        [LEARN_FLOW_DRAFT_KEY]: initialSlice(),
      };
      set({
        boundConversationId: conversationId,
        slices,
        ...draftSlice,
      });
    },

    dropConversationSlice: (conversationId) => {
      const state = get();
      if (!conversationId || conversationId === LEARN_FLOW_DRAFT_KEY) return;
      const slices = { ...state.slices };
      delete slices[conversationId];
      set({ slices });
    },

    getActiveSnapshot: () => {
      const state = get();
      const slice = projectActive(state.boundConversationId, state.slices);
      return snapshotFromSlice(slice);
    },

    setModePreference: (mode) => {
      set((s) => writeActive(s, { modePreference: mode }));
    },

    setCurrentTurnId: (turnId) => {
      set((s) => writeActive(s, { currentTurnId: turnId }));
    },

    resetActiveSlice: () => {
      set((s) => {
        const key = learnFlowSliceKey(s.boundConversationId);
        const next = initialSlice();
        // Keep mode preference on reset of messages? Prefer clear for clearMessages.
        return {
          boundConversationId: s.boundConversationId,
          slices: { ...s.slices, [key]: next },
          ...next,
        };
      });
    },

    applyOrchestratorResult: (result, opts) => {
      const state = get();
      const expectedConversationId =
        opts?.expectedConversationId !== undefined
          ? opts.expectedConversationId
          : state.boundConversationId;
      const key = learnFlowSliceKey(state.boundConversationId);
      const slice = state.slices[key] ?? projectActive(state.boundConversationId, state.slices);

      if (
        isStaleConversationWrite({
          expectedConversationId,
          boundConversationId: state.boundConversationId,
          expectedGeneration: opts?.expectedGeneration,
          currentGeneration: slice.requestGeneration,
        })
      ) {
        return false;
      }

      const rawStage = (result.nextStage as string) || slice.stage;
      const stage = normalizeLearnStage(rawStage);

      // Empty artifacts MUST clear — no sticky merge of prior turn cards.
      const gatedIncoming = gateArtifactsCopy(
        (result.artifacts ?? []) as LearnArtifact[],
      );
      const nextArtifacts = applyTurnArtifacts(
        slice.artifacts as MessageTurnArtifact[],
        gatedIncoming as MessageTurnArtifact[],
      ) as LearnArtifact[];

      const merged = mergeFromArtifacts(nextArtifacts, {
        topic: result.topic || (nextArtifacts.length > 0 ? slice.topic : ''),
        proposal:
          result.proposal || (nextArtifacts.length > 0 ? slice.proposal : ''),
      });

      // When artifacts cleared, also clear calibration/outline derived UI state.
      const clearedDerived =
        nextArtifacts.length === 0
          ? {
              calibrationQuestion: '',
              calibrationOptions: [] as string[],
              calibrationSelected: null as number | null,
              calibrationSelectedIndices: [] as number[],
              calibrationKind: null as LearnFlowSlice['calibrationKind'],
              resources: [] as ResourceItem[],
              outlineUnits: [] as OutlineUnitArtifact[],
            }
          : {};

      const pendingDesktop =
        result.route === 'desktop' && !result.runDesktop
          ? slice.pendingDesktopMessage
          : result.runDesktop
            ? null
            : slice.pendingDesktopMessage;
      const resolvedStage =
        stage === 'idle' && result.route === 'learn_confirm'
          ? 'intent_proposed'
          : stage;

      set((s) =>
        writeActive(s, {
          ...merged,
          ...clearedDerived,
          stage: resolvedStage,
          artifacts: nextArtifacts,
          desktopEvents: result.desktopEvents
            ? [...slice.desktopEvents, ...result.desktopEvents]
            : slice.desktopEvents,
          lastRoute: result.route,
          streamChat: !!result.streamChat,
          runDesktop: !!result.runDesktop,
          experienceMode:
            result.experiencePlan?.mode ||
            (result.streamChat && !result.runDesktop
              ? slice.experienceMode || 'normal'
              : nextArtifacts.length === 0 && !result.experiencePlan?.mode
                ? null
                : slice.experienceMode),
          pendingDesktopMessage: pendingDesktop,
          error: result.error || null,
          midFlowHint: null,
        }),
      );
      return true;
    },

    callOrchestrator: async (message, action, providerId, extra) => {
      const boundId = get().boundConversationId;
      set((s) => {
        const key = learnFlowSliceKey(s.boundConversationId);
        const prev = s.slices[key] ?? initialSlice();
        const gen = prev.requestGeneration + 1;
        return writeActive(s, {
          loading: true,
          error: null,
          streamChat: false,
          runDesktop: false,
          midFlowHint: null,
          requestGeneration: gen,
        });
      });

      const state = get();
      const key = learnFlowSliceKey(state.boundConversationId);
      const slice = state.slices[key] ?? initialSlice();
      const expectedGeneration = slice.requestGeneration;

      try {
        const res = await fetch('/api/agents/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message,
            action,
            providerId,
            systemPrompt: useSettingsStore.getState().settings.systemPrompt,
            chatHistory: extra?.chatHistory,
            context: {
              stage: slice.stage,
              topic: extra?.knownGoal || slice.topic,
              proposal: slice.proposal || extra?.knownGoal || slice.topic,
              memoryEntries: slice.memoryEntries,
              calibrationSelected: slice.calibrationSelected,
              calibrationSelectedIndices: slice.calibrationSelectedIndices,
              calibrationAnswer: extra?.calibrationAnswer,
              calibrationKind: slice.calibrationKind,
              resources: slice.resources,
              outlineUnits: slice.outlineUnits,
              requestedExecutionMode: extra?.requestedExecutionMode,
              trustConfirmed: extra?.trustConfirmed,
              userModePreference:
                extra?.userModePreference ?? slice.modePreference ?? null,
              surface: extra?.surface ?? 'chat',
              experienceMode: slice.experienceMode ?? undefined,
              knownGoal: extra?.knownGoal || slice.topic || undefined,
              knownLevel:
                extra?.knownLevel || extra?.calibrationAnswer || undefined,
            },
          }),
        });
        const json = (await res.json()) as OrchestratorResult & {
          success?: boolean;
          error?: string;
        };
        if (!res.ok && !json.artifacts?.length) {
          throw new Error(json.error || `Orchestrator HTTP ${res.status}`);
        }

        // Race: user switched conversation mid-flight.
        if (
          isStaleConversationWrite({
            expectedConversationId: boundId,
            boundConversationId: get().boundConversationId,
            expectedGeneration,
            currentGeneration: get().slices[learnFlowSliceKey(boundId)]
              ?.requestGeneration,
          })
        ) {
          return json;
        }

        if (json.route === 'desktop') {
          set((s) => writeActive(s, { pendingDesktopMessage: message }));
        }
        get().applyOrchestratorResult(json, {
          expectedConversationId: boundId,
          expectedGeneration,
        });
        set((s) => writeActive(s, { loading: false }));
        return json;
      } catch (err) {
        if (
          !isStaleConversationWrite({
            expectedConversationId: boundId,
            boundConversationId: get().boundConversationId,
            expectedGeneration,
            currentGeneration: get().slices[learnFlowSliceKey(boundId)]
              ?.requestGeneration,
          })
        ) {
          const msg = err instanceof Error ? err.message : 'Orchestrator failed';
          set((s) => writeActive(s, { loading: false, error: msg }));
        }
        throw err;
      }
    },

    considerUserMessage: async (
      text,
      providerId,
      chatHistory,
      requestedExecutionMode,
      opts,
    ) => {
      const state = get();
      const decision = decideMidFlowRoute({
        stage: state.stage,
        message: text,
        hasFreeTextArtifact: state.calibrationKind === 'free_text',
        hasMultiChoiceArtifact: state.calibrationKind === 'multi_choice',
        hasSingleChoiceArtifact: state.calibrationKind === 'single_choice',
        calibrationPending:
          state.calibrationKind === 'multi_choice'
            ? state.calibrationSelectedIndices.length === 0
            : state.calibrationSelected === null,
      });

      const modePref =
        opts?.userModePreference !== undefined
          ? opts.userModePreference
          : state.modePreference;

      switch (decision.kind) {
        case 'select_calibration': {
          set((s) => writeActive(s, { calibrationSelected: null }));
          return get().callOrchestrator(
            decision.message,
            'select_calibration',
            providerId,
            {
              chatHistory,
              calibrationAnswer: decision.message,
              userModePreference: modePref,
              surface: opts?.surface,
            },
          );
        }
        case 'orchestrator_intent': {
          return get().callOrchestrator(decision.message, 'intent', providerId, {
            chatHistory,
            requestedExecutionMode,
            userModePreference: modePref,
            surface: opts?.surface,
          });
        }
        case 'blocked_await_ui': {
          const hint = gateOutboundCopy(decision.hint, '请先完成当前步骤。');
          set((s) =>
            writeActive(s, {
              midFlowHint: hint,
              streamChat: false,
              runDesktop: false,
            }),
          );
          return {
            route: 'learn_calibrate',
            artifacts: [
              {
                id: `hint_${Date.now()}`,
                kind: 'plain_assistant' as const,
                content: hint,
              },
            ],
            streamChat: false,
            nextStage: state.stage,
          };
        }
        case 'chat': {
          return {
            route: 'chat',
            artifacts: [],
            streamChat: true,
            // Public meta only — no internalReason on client (batch-05)
            experiencePlan: {
              mode: modePref === 'deep' ? 'deep_planning' : 'chat',
              requiredSteps: ['direct_answer'],
              optionalSteps: [],
              skippedSteps: [],
              surface: opts?.surface || 'chat',
              nextAction: 'stream_chat',
              commitPolicy: 'none',
              confidence: 1,
            },
          };
        }
        default: {
          const _exhaustive: never = decision;
          return _exhaustive;
        }
      }
    },

    confirmIntent: async (providerId) => {
      const { proposal, topic, stage } = get();
      // propose ≠ commit: only explicit confirm; never auto from autonomy
      if (normalizeLearnStage(stage) !== 'intent_proposed') return;
      await get().callOrchestrator(
        proposal || topic || 'confirm',
        'confirm_learn',
        providerId,
      );
    },

    rejectIntent: async (providerId) => {
      try {
        await get().callOrchestrator('reject', 'reject_learn', providerId);
      } finally {
        set((s) =>
          writeActive(s, {
            ...initialSlice(),
            stage: 'rejected',
            modePreference: s.modePreference,
          }),
        );
      }
    },

    continueFromMemory: async (providerId) => {
      await get().callOrchestrator('continue', 'continue_memory', providerId);
    },

    selectCalibration: async (index, providerId) => {
      const {
        calibrationOptions,
        calibrationKind,
        artifacts,
        modePreference,
        topic,
      } = get();
      // Multi-select: toggle only — explicit「继续」via submitMultiCalibration.
      if (calibrationKind === 'multi_choice') {
        get().toggleCalibrationOption(index);
        const nextLen = get().calibrationSelectedIndices.length;
        set((s) =>
          writeActive(s, {
            midFlowHint:
              nextLen === 0
                ? '请至少选择一个选项，然后点「继续」。'
                : null,
          }),
        );
        return;
      }
      if (index < 0 || index >= calibrationOptions.length) return;
      const answer = calibrationOptions[index]!;
      set((s) => writeActive(s, { calibrationSelected: index, midFlowHint: null }));

      const clarifyMeta = artifacts.find((a) => a.clarification)?.clarification;
      const field = clarifyMeta?.field;

      // Topic / goal clarify → real intent turn with knownGoal (not level calibration).
      if (field === 'topic' || field === 'goal') {
        set((s) =>
          writeActive(s, {
            topic: answer,
            proposal: answer,
            modePreference: modePreference === 'normal' ? 'deep' : modePreference || 'deep',
          }),
        );
        await get().callOrchestrator(answer, 'intent', providerId, {
          userModePreference: 'deep',
          knownGoal: answer,
        });
        return;
      }

      // Level (or legacy calibration) → select_calibration with knownGoal preserved.
      await get().callOrchestrator(answer, 'select_calibration', providerId, {
        calibrationAnswer: answer,
        knownGoal: topic || undefined,
        knownLevel: answer,
        userModePreference: modePreference === 'normal' ? null : modePreference || 'deep',
      });
    },

    toggleCalibrationOption: (index) => {
      const { calibrationOptions, calibrationSelectedIndices, calibrationKind } =
        get();
      if (calibrationKind !== 'multi_choice') return;
      if (index < 0 || index >= calibrationOptions.length) return;
      const setIdx = new Set(calibrationSelectedIndices);
      if (setIdx.has(index)) setIdx.delete(index);
      else setIdx.add(index);
      set((s) =>
        writeActive(s, {
          calibrationSelectedIndices: Array.from(setIdx).sort((a, b) => a - b),
        }),
      );
    },

    submitMultiCalibration: async (providerId) => {
      const {
        calibrationOptions,
        calibrationSelectedIndices,
        calibrationKind,
        artifacts,
        topic,
        modePreference,
      } = get();
      if (calibrationKind !== 'multi_choice') return;
      if (calibrationSelectedIndices.length === 0) {
        set((s) =>
          writeActive(s, {
            midFlowHint: '请至少选择一个选项，然后点「继续」。',
          }),
        );
        return;
      }
      const answers = calibrationSelectedIndices
        .map((i) => calibrationOptions[i])
        .filter((x): x is string => Boolean(x));
      const answer = answers.join('；');
      set((s) =>
        writeActive(s, {
          calibrationSelected: calibrationSelectedIndices[0] ?? null,
          midFlowHint: null,
        }),
      );

      const clarifyMeta = artifacts.find((a) => a.clarification)?.clarification;
      if (clarifyMeta?.field === 'topic' || clarifyMeta?.field === 'goal') {
        set((s) =>
          writeActive(s, {
            topic: answer,
            proposal: answer,
            modePreference: modePreference || 'deep',
          }),
        );
        await get().callOrchestrator(answer, 'intent', providerId, {
          userModePreference: 'deep',
          knownGoal: answer,
        });
        return;
      }

      await get().callOrchestrator(answer, 'select_calibration', providerId, {
        calibrationAnswer: answer,
        knownGoal: topic || undefined,
        knownLevel: answer,
      });
    },

    advanceFromResources: async (providerId) => {
      const { stage, outlineUnits } = get();
      const n = normalizeLearnStage(stage);
      if (n !== 'outline' && n !== 'calibration') return;
      if (outlineUnits.length === 0) return;
      await get().callOrchestrator('advance', 'advance_resources', providerId);
    },

    confirmTrustElevation: () => {
      set((s) =>
        writeActive(s, {
          stage: 'idle',
          runDesktop: true,
          streamChat: false,
          desktopEvents: s.desktopEvents.filter(
            (e) => e.kind !== 'pending_tool_confirm',
          ),
          desktopResume: { trustConfirmed: true, nonce: Date.now() },
        }),
      );
    },

    rejectTrustElevation: () => {
      set((s) =>
        writeActive(s, {
          stage: 'idle',
          runDesktop: true,
          streamChat: false,
          desktopEvents: [
            ...s.desktopEvents.filter((e) => e.kind !== 'pending_tool_confirm'),
            {
              id: `evt_${Date.now()}`,
              kind: 'thinking',
              content: '已拒绝 trust；将以 sandbox 执行。',
            },
          ],
          desktopResume: { trustConfirmed: false, nonce: Date.now() },
        }),
      );
    },

    clearDesktopResume: () => set((s) => writeActive(s, { desktopResume: null })),

    setCourseAndSession: (courseId, sessionId) => {
      set((s) => writeActive(s, { courseId, sessionId, stage: 'ready' }));
    },

    setOutlineUnitsPreview: (units) => {
      const artifacts = get().artifacts.map((a) =>
        a.kind === 'outline_card'
          ? {
              ...a,
              units: units.map((u) => ({
                ...u,
                knowledgePoints: [...u.knowledgePoints],
              })),
            }
          : a,
      );
      set((s) =>
        writeActive(s, {
          outlineUnits: units.map((u) => ({
            ...u,
            knowledgePoints: [...u.knowledgePoints],
          })),
          artifacts,
        }),
      );
    },

    setSessionPhaseStage: (stage) => {
      set((s) => writeActive(s, { stage: normalizeLearnStage(stage) }));
    },

    pushDesktopEvent: (event) => {
      set((s) =>
        writeActive(s, { desktopEvents: [...s.desktopEvents, event] }),
      );
    },

    reset: () => {
      set({
        boundConversationId: null,
        slices: { [LEARN_FLOW_DRAFT_KEY]: initialSlice() },
        ...initialSlice(),
      });
    },
  };
});
