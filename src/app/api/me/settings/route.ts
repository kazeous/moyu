import {
  getUserSettings,
  updateUserSettings,
} from "@/server/db/repositories/user-settings";
import { updateUserSettingsInputSchema } from "@/server/metadata-contract";
import { metadataRead, metadataMutation } from "@/server/http/metadata-routes";

export const GET = (request: Request) =>
  metadataRead(
    async (owner) =>
      (await getUserSettings(owner)) ?? {
        theme: "system",
        interfaceLanguage: "en",
      },
    request,
  );
export const PATCH = (request: Request) =>
  metadataMutation(request, updateUserSettingsInputSchema, updateUserSettings);
