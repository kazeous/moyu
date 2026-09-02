import {
  findPhraseById,
  updatePhrase,
  deletePhrase,
} from "@/server/db/repositories/phrases";
import { createPhraseInputSchema } from "@/server/metadata-contract";
import {
  metadataRead,
  metadataMutation,
  metadataDelete,
  presentPhrase,
  presentFound,
  detailId,
  type DetailContext,
} from "@/server/http/metadata-routes";

export const GET = (request: Request, context: DetailContext) =>
  metadataRead(
    async (owner) =>
      presentFound(
        await findPhraseById(owner, await detailId(context)),
        presentPhrase,
      ),
    request,
  );
export const PUT = (request: Request, context: DetailContext) =>
  metadataMutation(request, createPhraseInputSchema, async (owner, input) =>
    presentFound(
      await updatePhrase(owner, await detailId(context), input),
      presentPhrase,
    ),
  );
export const DELETE = (request: Request, context: DetailContext) =>
  metadataDelete(request, async (owner) =>
    deletePhrase(owner, await detailId(context)),
  );
