import { describe, expect, it } from 'vitest';
import {
  canShowModeToggle,
  canUpgradeToDeep,
  effectiveExperienceMode,
  isDeepExperience,
  modeToggleUiState,
  resolveTogglePreference,
} from '../effective-experience-mode';

describe('effectiveExperienceMode selector', () => {
  it('course route → deep_course regardless of preference', () => {
    expect(
      effectiveExperienceMode({
        route: '/course/abc',
        modePreference: 'normal',
        experienceMode: 'chat',
      }),
    ).toBe('deep_course');
  });

  it('live deep_planning wins over chat preference', () => {
    expect(
      effectiveExperienceMode({
        route: '/chat',
        experienceMode: 'deep_planning',
        modePreference: 'normal',
      }),
    ).toBe('deep_planning');
  });

  it('modePreference deep without live mode → deep_planning', () => {
    expect(
      effectiveExperienceMode({
        route: '/chat',
        conversation: {
          modePreference: 'deep',
          experience: null,
        },
      }),
    ).toBe('deep_planning');
  });

  it('defaults to chat when empty', () => {
    expect(effectiveExperienceMode({ route: '/chat' })).toBe('chat');
  });

  it('calendar / library surfaces', () => {
    expect(effectiveExperienceMode({ route: '/calendar' })).toBe('calendar');
    expect(effectiveExperienceMode({ route: 'library' })).toBe('library');
  });
});

describe('Deep button visibility / mode toggle UI', () => {
  it('chat/normal show toggle and upgrade; not deep status', () => {
    for (const mode of ['chat', 'normal'] as const) {
      const ui = modeToggleUiState(mode);
      expect(ui.showToggle).toBe(true);
      expect(ui.showUpgradeCta).toBe(true);
      expect(ui.showDeepStatus).toBe(false);
      expect(canShowModeToggle(mode)).toBe(true);
      expect(canUpgradeToDeep(mode)).toBe(true);
    }
  });

  it('deep_planning shows status, hides toggle and upgrade CTA', () => {
    const ui = modeToggleUiState('deep_planning');
    expect(ui.showToggle).toBe(false);
    expect(ui.showDeepStatus).toBe(true);
    expect(ui.showUpgradeCta).toBe(false);
    expect(ui.deepStatusLabel).toMatch(/规划/);
    expect(canShowModeToggle('deep_planning')).toBe(false);
    expect(canUpgradeToDeep('deep_planning')).toBe(false);
    expect(isDeepExperience('deep_planning')).toBe(true);
  });

  it('deep_course hides mode switch and upgrade entirely', () => {
    const ui = modeToggleUiState('deep_course');
    expect(ui.showToggle).toBe(false);
    expect(ui.showDeepStatus).toBe(false);
    expect(ui.showUpgradeCta).toBe(false);
    expect(canShowModeToggle('deep_course')).toBe(false);
    expect(canUpgradeToDeep('deep_course')).toBe(false);
  });

  it('resolveTogglePreference reflects deep while planning', () => {
    expect(resolveTogglePreference('deep_planning', 'normal')).toBe('deep');
    expect(resolveTogglePreference('chat', 'deep')).toBe('deep');
    expect(resolveTogglePreference('chat', null)).toBe('normal');
  });
});
