import { create } from 'zustand';
import { AgentState, Message, TaskStep, ToolCall, Artifact, PendingToolCall, ExecutionStep, ToolStreamEntry } from '@/types/agent';

interface AgentStore {
  state: AgentState;
  addMessage: (message: Message) => void;
  updateStep: (stepId: string, updates: Partial<TaskStep>) => void;
  addToolCall: (toolCall: ToolCall) => void;
  updateToolCall: (toolCallId: string, updates: Partial<ToolCall>) => void;
  addToolStream: (entry: ToolStreamEntry) => void;
  clearToolStreams: () => void;
  addArtifact: (artifact: Artifact) => void;
  setStatus: (status: AgentState['status']) => void;
  setPlan: (plan: TaskStep[]) => void;
  setCurrentStep: (step: number) => void;
  setPendingToolCall: (pending: PendingToolCall | undefined) => void;
  addExecutionStep: (step: ExecutionStep) => void;
  updateExecutionStep: (stepId: string, updates: Partial<ExecutionStep>) => void;
  setExecutionSteps: (steps: ExecutionStep[]) => void;
  reset: () => void;
}

const initialState: AgentState = {
  status: 'idle',
  plan: [],
  currentStep: 0,
  messages: [],
  toolCalls: [],
  toolStreams: [],
  artifacts: [],
  pendingToolCall: undefined,
  executionSteps: [],
};

export const useAgentStore = create<AgentStore>((set) => ({
  state: initialState,

  addMessage: (message) =>
    set((store) => ({
      state: {
        ...store.state,
        messages: [...store.state.messages, message],
      },
    })),

  updateStep: (stepId, updates) =>
    set((store) => ({
      state: {
        ...store.state,
        plan: store.state.plan.map((step) =>
          step.id === stepId ? { ...step, ...updates } : step
        ),
      },
    })),

  addToolCall: (toolCall) =>
    set((store) => ({
      state: {
        ...store.state,
        toolCalls: [...store.state.toolCalls, toolCall],
      },
    })),

  updateToolCall: (toolCallId, updates) =>
    set((store) => ({
      state: {
        ...store.state,
        toolCalls: store.state.toolCalls.map((tc) =>
          tc.id === toolCallId ? { ...tc, ...updates } : tc
        ),
      },
    })),

  addToolStream: (entry) =>
    set((store) => ({
      state: {
        ...store.state,
        toolStreams: [...store.state.toolStreams, entry],
      },
    })),

  clearToolStreams: () =>
    set((store) => ({
      state: { ...store.state, toolStreams: [] },
    })),

  addArtifact: (artifact) =>
    set((store) => ({
      state: {
        ...store.state,
        artifacts: [...store.state.artifacts, artifact],
      },
    })),

  setStatus: (status) =>
    set((store) => ({
      state: { ...store.state, status },
    })),

  setPlan: (plan) =>
    set((store) => ({
      state: { ...store.state, plan },
    })),

  setCurrentStep: (step) =>
    set((store) => ({
      state: { ...store.state, currentStep: step },
    })),

  setPendingToolCall: (pending) =>
    set((store) => ({
      state: { ...store.state, pendingToolCall: pending },
    })),

  addExecutionStep: (step) =>
    set((store) => ({
      state: {
        ...store.state,
        executionSteps: [...(store.state.executionSteps || []), step],
      },
    })),

  updateExecutionStep: (stepId, updates) =>
    set((store) => ({
      state: {
        ...store.state,
        executionSteps: (store.state.executionSteps || []).map((s) =>
          s.id === stepId ? { ...s, ...updates } : s
        ),
      },
    })),

  setExecutionSteps: (steps) =>
    set((store) => ({
      state: { ...store.state, executionSteps: steps },
    })),

  reset: () => set({ state: initialState }),
}));
