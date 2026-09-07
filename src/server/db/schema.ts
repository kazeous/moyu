import { sql } from "drizzle-orm";
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export const sourceLanguage = pgEnum("source_language", ["ja", "zh"]);
export const glossLanguage = pgEnum("gloss_language", ["en", "vi"]);
export const theme = pgEnum("theme", ["system", "light", "dark"]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
};

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  ...timestamps,
});

export const credentials = pgTable("credentials", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  passwordHash: text("password_hash").notNull(),
  ...timestamps,
});

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [index("auth_sessions_user_id_idx").on(table.userId)],
);

export const magicLinkTokens = pgTable(
  "magic_link_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: text("email").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("magic_link_tokens_email_idx").on(table.email)],
);

export const workTags = pgTable(
  "work_tags",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    aliases: jsonb("aliases")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    ...timestamps,
  },
  (table) => [
    unique("work_tags_owner_id_name_unique").on(table.ownerId, table.name),
    index("work_tags_owner_id_idx").on(table.ownerId),
  ],
);

export const customPhrases = pgTable(
  "custom_phrases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sourcePhrase: text("source_phrase").notNull(),
    language: sourceLanguage("language").notNull(),
    note: text("note"),
    matchingMode: text("matching_mode").notNull().default("exact"),
    ...timestamps,
  },
  (table) => [index("custom_phrases_owner_id_idx").on(table.ownerId)],
);

export const phraseGlosses = pgTable(
  "phrase_glosses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    phraseId: uuid("phrase_id")
      .notNull()
      .references(() => customPhrases.id, { onDelete: "cascade" }),
    language: glossLanguage("language").notNull(),
    text: text("text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("phrase_glosses_phrase_id_language_unique").on(
      table.phraseId,
      table.language,
    ),
    index("phrase_glosses_phrase_id_idx").on(table.phraseId),
  ],
);

export const phraseTags = pgTable(
  "phrase_tags",
  {
    phraseId: uuid("phrase_id")
      .notNull()
      .references(() => customPhrases.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => workTags.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.phraseId, table.tagId] }),
    index("phrase_tags_tag_id_idx").on(table.tagId),
  ],
);

export const userSettings = pgTable("user_settings", {
  ownerId: uuid("owner_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  theme: theme("theme").notNull().default("system"),
  interfaceLanguage: glossLanguage("interface_language")
    .notNull()
    .default("en"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const databaseSchema = {
  users,
  credentials,
  authSessions,
  magicLinkTokens,
  workTags,
  customPhrases,
  phraseGlosses,
  phraseTags,
  userSettings,
};
