import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  resolveEffectivePolicy,
  mayAutoApproveTool,
  isGrantExpired,
  writeServerSafetyStore,
  revokeServerGrant,
  readServerSafetyStore,
  migrateFromExecutionMode,
  clientDowngradeIfExpired,
  categoryForTool,
  detectRedLines,
  type AutonomyGrant,
  type EffectivePolicy,
} from '../action-policy';

const tmpRoot = path.join(
  os.tmpdir(),
  `minus-action-policy-${process.pid}-${Date.now()}`,
);

describe('action-policy', () => {
  beforeEach(() => {
    fs.mkdirSync(tmpRoot, { recursive: true });
    process.env.MINUS_DATA_DIR = tmpRoot;
    // clean slate
    const grantFile = path.join(tmpRoot, 'autonomy-grant.json');
    if (fs.existsSync(grantFile)) fs.unlinkSync(grantFile);
  });

  afterEach(() => {
    delete process.env.MINUS_DATA_DIR;
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  describe('migrateFromExecutionMode', () => {
    it('maps sandbox → sandbox + supervised', () => {
      const m = migrateFromExecutionMode('sandbox');
      expect(m.executionEnvironment).toBe('sandbox');
      expect(m.approvalPolicy).toBe('supervised');
      expect(m.executionMode).toBe('sandbox');
    });

    it('maps trust → local + supervised (not full_auto)', () => {
      const m = migrateFromExecutionMode('trust');
      expect(m.executionEnvironment).toBe('local');
      expect(m.approvalPolicy).toBe('supervised');
      expect(m.executionMode).toBe('trust');
    });
  });

  describe('grant expiry', () => {
    it('isGrantExpired true for past dates', () => {
      const g: AutonomyGrant = {
        allowedCategories: ['web_search'],
        expiresAt: new Date(Date.now() - 1000).toISOString(),
        approvedBy: 'user',
      };
      expect(isGrantExpired(g)).toBe(true);
    });

    it('clientDowngradeIfExpired downgrades bounded_auto', () => {
      const r = clientDowngradeIfExpired('bounded_auto', {
        allowedCategories: ['code_run'],
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
        approvedBy: 'user',
      });
      expect(r.expired).toBe(true);
      expect(r.approvalPolicy).toBe('supervised');
      expect(r.autonomyGrant).toBeNull();
      expect(r.executionMode).toBe('sandbox');
    });

    it('expired server grant downgrades resolveEffectivePolicy', () => {
      writeServerSafetyStore({
        approvalPolicy: 'full_auto',
        executionEnvironment: 'local',
        grant: {
          allowedCategories: ['web_search', 'code_run'],
          expiresAt: new Date(Date.now() - 5000).toISOString(),
          approvedBy: 'user',
        },
      });

      const eff = resolveEffectivePolicy({
        approvalPolicy: 'full_auto',
      });

      expect(eff.approvalPolicy).toBe('supervised');
      expect(eff.executionMode).toBe('sandbox');
      expect(eff.grant).toBeNull();
      expect(eff.downgradeReason).toBeTruthy();
    });
  });

  describe('forge full_auto rejected', () => {
    it('rejects client full_auto without server grant', () => {
      // server empty
      const store = readServerSafetyStore();
      expect(store.grant).toBeNull();

      const eff = resolveEffectivePolicy({
        approvalPolicy: 'full_auto',
        executionEnvironment: 'local',
        autonomyGrant: {
          allowedCategories: ['web_search', 'code_run', 'artifacts_write', 'package_install'],
          expiresAt: new Date(Date.now() + 3600_000).toISOString(),
          approvedBy: 'user',
        },
      });

      expect(eff.approvalPolicy).toBe('supervised');
      expect(eff.toolsAllowed).toBe(true);
      expect(eff.autoApprovedCategories).toEqual([]);
      expect(eff.downgradeReason).toMatch(/无有效授权|拒绝/);
    });

    it('rejects client bounded_auto without server grant', () => {
      const eff = resolveEffectivePolicy({
        approvalPolicy: 'bounded_auto',
        autonomyGrant: {
          allowedCategories: ['web_search'],
          expiresAt: new Date(Date.now() + 3600_000).toISOString(),
          approvedBy: 'user',
        },
      });
      expect(eff.approvalPolicy).toBe('supervised');
      expect(eff.autoApprovedCategories).toEqual([]);
    });

    it('honors full_auto when server grant is valid', () => {
      const expiresAt = new Date(Date.now() + 3600_000).toISOString();
      writeServerSafetyStore({
        approvalPolicy: 'full_auto',
        executionEnvironment: 'local',
        grant: {
          allowedCategories: ['web_search', 'code_run'],
          expiresAt,
          approvedBy: 'user',
        },
      });

      const eff = resolveEffectivePolicy({
        approvalPolicy: 'full_auto',
      });

      expect(eff.approvalPolicy).toBe('full_auto');
      expect(eff.executionEnvironment).toBe('local');
      expect(eff.executionMode).toBe('trust');
      expect(eff.autoApprovedCategories).toEqual(
        expect.arrayContaining(['web_search', 'code_run']),
      );
      expect(eff.toolsAllowed).toBe(true);
    });
  });

  describe('chat_only blocks tools', () => {
    it('toolsAllowed false for chat_only', () => {
      const eff = resolveEffectivePolicy({ approvalPolicy: 'chat_only' });
      expect(eff.approvalPolicy).toBe('chat_only');
      expect(eff.toolsAllowed).toBe(false);
      expect(eff.executionMode).toBe('sandbox');
    });
  });

  describe('mayAutoApproveTool', () => {
    function basePolicy(over: Partial<EffectivePolicy> = {}): EffectivePolicy {
      return {
        approvalPolicy: 'supervised',
        executionEnvironment: 'sandbox',
        executionMode: 'sandbox',
        toolsAllowed: true,
        autoApprovedCategories: [],
        dangerousConfirmed: false,
        grant: null,
        redLines: [],
        ...over,
      };
    }

    it('supervised without confirm → not auto', () => {
      const r = mayAutoApproveTool(basePolicy(), 'web_search', { query: 'x' });
      expect(r.auto).toBe(false);
    });

    it('supervised with dangerousConfirmed → auto (non red-line)', () => {
      const r = mayAutoApproveTool(
        basePolicy({ dangerousConfirmed: true }),
        'web_search',
        { query: 'x' },
      );
      expect(r.auto).toBe(true);
    });

    it('bounded_auto auto-approves allowed category only', () => {
      const policy = basePolicy({
        approvalPolicy: 'bounded_auto',
        autoApprovedCategories: ['web_search'],
        dangerousConfirmed: true,
      });
      expect(mayAutoApproveTool(policy, 'web_search', { query: 'a' }).auto).toBe(true);
      expect(mayAutoApproveTool(policy, 'code_executor', { code: '1' }).auto).toBe(false);
    });

    it('red-line never auto even under full_auto', () => {
      const policy = basePolicy({
        approvalPolicy: 'full_auto',
        executionEnvironment: 'local',
        executionMode: 'trust',
        autoApprovedCategories: ['code_run', 'artifacts_write'],
        dangerousConfirmed: true,
      });
      const r = mayAutoApproveTool(policy, 'code_executor', {
        code: 'import os; open("/etc/passwd")',
        // path-ish in params triggers credentials/path
      });
      // /etc/passwd in blob → credentials or path_escape
      expect(r.auto).toBe(false);
      expect(r.redLines.length).toBeGreaterThan(0);
    });
  });

  describe('categoryForTool', () => {
    it('maps known tools', () => {
      expect(categoryForTool('web_search')).toBe('web_search');
      expect(categoryForTool('code_executor')).toBe('code_run');
      expect(categoryForTool('file_manager', { action: 'write' })).toBe(
        'artifacts_write',
      );
      expect(categoryForTool('file_manager', { action: 'read' })).toBeNull();
      expect(categoryForTool('ask_human')).toBeNull();
    });
  });

  describe('detectRedLines', () => {
    it('flags credentials patterns', () => {
      const hits = detectRedLines('file_manager', {
        action: 'read',
        path: '.ssh/id_rsa',
      });
      expect(hits).toContain('credentials');
    });
  });

  describe('revokeServerGrant', () => {
    it('clears elevated store to supervised', () => {
      writeServerSafetyStore({
        approvalPolicy: 'full_auto',
        executionEnvironment: 'local',
        grant: {
          allowedCategories: ['web_search'],
          expiresAt: new Date(Date.now() + 99999).toISOString(),
          approvedBy: 'user',
        },
      });
      const after = revokeServerGrant();
      expect(after.approvalPolicy).toBe('supervised');
      expect(after.grant).toBeNull();
      expect(after.executionEnvironment).toBe('sandbox');
    });
  });
});
