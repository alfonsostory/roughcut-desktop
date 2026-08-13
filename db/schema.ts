import { sql } from "drizzle-orm";
import { index, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const humanCorrections = sqliteTable("human_corrections", {
  id: text("id").primaryKey(),
  candidateCutId: text("candidate_cut_id").notNull(),
  aiStart: real("ai_start").notNull(),
  aiEnd: real("ai_end").notNull(),
  humanStart: real("human_start").notNull(),
  humanEnd: real("human_end").notNull(),
  humanAction: text("human_action", { enum: ["adjusted", "approved", "rejected"] }).notNull(),
  reason: text("reason").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_human_corrections_candidate_cut_id").on(table.candidateCutId),
]);
