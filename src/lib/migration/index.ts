/**
 * Client migration barrel.
 * UX08 compat + batch-02 conversation-aggregate schema v2.
 * Server learning v1→v2 stays in `lib/learning/migrate`.
 */

export {
  UX08_MIGRATE_VERSION,
  migrateLearnFlowStage,
  migrateLearnFlowSnapshot,
  migrateActiveAppView,
  migrateChatPersistedState,
  rehydrateChatPersistSlice,
  migrateLearningPayloadCompat,
  migrateMemoryPayloadCompat,
  migrateSafetyFieldsCompat,
  migrateHitlAuditRecords,
  migrateClientBootstrap,
  assertNoContentLoss,
  type MigratedChatState,
  type LearningMigrateResult,
  type MemoryMigrateResult,
  type SafetyMigrateInput,
  type HitlAuditLike,
  type ClientBootstrapInput,
  type ClientBootstrapResult,
} from './ux08-client-migrate';

export {
  CHAT_PERSIST_SCHEMA_VERSION,
  migrateChatPersistToV2,
  rehydrateChatPersistV2,
  migrateGlobalLearnFlowToActiveConversation,
  seedLearnFlowSlicesFromChat,
  type ChatPersistV2State,
  type ChatPersistV2Conversation,
  type ChatMigrateResult,
  type LegacyGlobalLearnFlow,
} from './conversation-aggregate-migrate';