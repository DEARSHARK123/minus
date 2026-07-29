export interface TraceSpan {
  id: string;
  parentId?: string;
  name: string;
  startTime: number;
  endTime?: number;
  attributes: Record<string, unknown>;
  events: TraceEvent[];
  status: 'ok' | 'error' | 'unset';
  statusMessage?: string;
}

export interface TraceEvent {
  name: string;
  timestamp: number;
  attributes?: Record<string, unknown>;
}

export interface Trace {
  id: string;
  rootSpan: TraceSpan;
  spans: Map<string, TraceSpan>;
  startTime: number;
  endTime?: number;
}

class TraceManager {
  private traces: Map<string, Trace> = new Map();
  private maxTraces = 50;

  startTrace(name: string): Trace {
    const id = `trace_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const rootSpan = this.createSpan(id, name);
    const trace: Trace = {
      id,
      rootSpan,
      spans: new Map([[rootSpan.id, rootSpan]]),
      startTime: Date.now(),
    };
    this.traces.set(id, trace);
    this.trimTraces();
    return trace;
  }

  createSpan(traceId: string, name: string, parentId?: string): TraceSpan {
    const span: TraceSpan = {
      id: `span_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      parentId,
      name,
      startTime: Date.now(),
      attributes: {},
      events: [],
      status: 'unset',
    };

    const trace = this.traces.get(traceId);
    if (trace) {
      trace.spans.set(span.id, span);
    }

    return span;
  }

  endSpan(traceId: string, spanId: string, status: TraceSpan['status'] = 'ok', message?: string): void {
    const trace = this.traces.get(traceId);
    if (!trace) return;

    const span = trace.spans.get(spanId);
    if (span) {
      span.endTime = Date.now();
      span.status = status;
      span.statusMessage = message;
    }
  }

  addEvent(traceId: string, spanId: string, name: string, attributes?: Record<string, unknown>): void {
    const trace = this.traces.get(traceId);
    if (!trace) return;

    const span = trace.spans.get(spanId);
    if (span) {
      span.events.push({
        name,
        timestamp: Date.now(),
        attributes,
      });
    }
  }

  endTrace(traceId: string): void {
    const trace = this.traces.get(traceId);
    if (trace) {
      trace.endTime = Date.now();
      trace.rootSpan.endTime = trace.endTime;
      if (trace.rootSpan.status === 'unset') {
        trace.rootSpan.status = 'ok';
      }
    }
  }

  getTrace(traceId: string): Trace | undefined {
    return this.traces.get(traceId);
  }

  getRecentTraces(count = 10): Trace[] {
    const all = Array.from(this.traces.values());
    return all.slice(-count);
  }

  private trimTraces(): void {
    if (this.traces.size > this.maxTraces) {
      const keys = Array.from(this.traces.keys());
      const toRemove = keys.slice(0, keys.length - this.maxTraces);
      for (const key of toRemove) {
        this.traces.delete(key);
      }
    }
  }
}

export const traceManager = new TraceManager();
