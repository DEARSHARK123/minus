import { describe, it, expect } from 'vitest';
import { migrateV1ToV2, LearningDataV1Schema } from '../migrate';
import { LearningDataSchema } from '@/types/learning';

const ts = '2026-07-12T08:00:00.000Z';

function v1Fixture() {
  return {
    version: 1,
    courses: [
      { id: 'c1', title: 'ML', createdAt: ts, updatedAt: ts },
    ],
    documents: [],
    goals: [],
    units: [],
    tasks: [
      {
        id: 't-pending',
        courseId: 'c1',
        title: 'Pending no schedule',
        estimatedMinutes: 30,
        status: 'pending',
        createdAt: ts,
        updatedAt: ts,
      },
      {
        id: 't-scheduled-pending',
        courseId: 'c1',
        title: 'Pending with schedule',
        estimatedMinutes: 30,
        status: 'pending',
        scheduledStart: '2026-07-13T09:00:00.000Z',
        scheduledEnd: '2026-07-13T09:30:00.000Z',
        createdAt: ts,
        updatedAt: ts,
      },
      {
        id: 't-in-progress',
        courseId: 'c1',
        title: 'In progress',
        estimatedMinutes: 30,
        status: 'in_progress',
        createdAt: ts,
        updatedAt: ts,
      },
      {
        id: 't-completed',
        courseId: 'c1',
        title: 'Completed',
        estimatedMinutes: 30,
        status: 'completed',
        createdAt: ts,
        updatedAt: ts,
      },
    ],
    timetable: [],
    sessions: [
      {
        id: 's1',
        courseId: 'c1',
        taskId: 't-in-progress',
        startedAt: ts,
        createdAt: ts,
        updatedAt: ts,
      },
    ],
  };
}

describe('migrateV1ToV2', () => {
  it('round-trips a v1 fixture to a valid v2 LearningData', () => {
    const v1 = v1Fixture();
    const v2 = migrateV1ToV2(v1);

    expect(LearningDataV1Schema.parse(v1).version).toBe(1);
    expect(LearningDataSchema.safeParse(v2).success).toBe(true);
    expect(v2.version).toBe(2);
  });

  it('maps task statuses correctly', () => {
    const v1 = v1Fixture();
    const v2 = migrateV1ToV2(v1);

    const byId = new Map(v2.tasks.map((t) => [t.id, t.status]));
    expect(byId.get('t-pending')).toBe('confirmed');
    expect(byId.get('t-scheduled-pending')).toBe('scheduled');
    expect(byId.get('t-in-progress')).toBe('in_progress');
    expect(byId.get('t-completed')).toBe('done');
  });

  it('gives sessions empty sections and a null currentSectionId', () => {
    const v1 = v1Fixture();
    const v2 = migrateV1ToV2(v1);

    expect(v2.sessions).toHaveLength(1);
    const session = v2.sessions[0]!;
    expect(session.sections).toEqual([]);
    expect(session.currentSectionId).toBeNull();
  });

  it('preserves courses, documents, goals, units, timetable', () => {
    const v1 = v1Fixture();
    const v2 = migrateV1ToV2(v1);

    expect(v2.courses).toEqual(v1.courses);
    expect(v2.documents).toEqual(v1.documents);
    expect(v2.goals).toEqual(v1.goals);
    expect(v2.units).toEqual(v1.units);
    expect(v2.timetable).toEqual(v1.timetable);
  });

  it('throws for non-v1 / invalid payloads', () => {
    expect(() => migrateV1ToV2({ version: 2, courses: [] })).toThrow();
    expect(() => migrateV1ToV2({ version: 1, courses: 'nope' })).toThrow();
  });
});
