import { eq } from "drizzle-orm";

import {
  updateUserSettingsInputSchema,
  type UpdateUserSettingsInput,
} from "@/server/metadata-contract";

import { getDatabaseClient } from "../client";
import { userSettings } from "../schema";

export type UserSettings = Pick<
  typeof userSettings.$inferSelect,
  "theme" | "interfaceLanguage"
>;

export async function getUserSettings(
  ownerId: string,
): Promise<UserSettings | null> {
  const [settings] = await getDatabaseClient()
    .select({
      theme: userSettings.theme,
      interfaceLanguage: userSettings.interfaceLanguage,
    })
    .from(userSettings)
    .where(eq(userSettings.ownerId, ownerId));

  return settings ?? null;
}

export async function updateUserSettings(
  ownerId: string,
  input: UpdateUserSettingsInput,
): Promise<UserSettings> {
  const parsedInput = updateUserSettingsInputSchema.parse(input);
  const [settings] = await getDatabaseClient()
    .insert(userSettings)
    .values({ ownerId, ...parsedInput })
    .onConflictDoUpdate({
      target: userSettings.ownerId,
      set: { ...parsedInput, updatedAt: new Date() },
    })
    .returning({
      theme: userSettings.theme,
      interfaceLanguage: userSettings.interfaceLanguage,
    });

  if (!settings) {
    throw new Error("Unable to update user settings");
  }

  return settings;
}
