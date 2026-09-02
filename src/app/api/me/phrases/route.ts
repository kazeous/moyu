import { createPhrase, listPhrases } from "@/server/db/repositories/phrases";
import { createPhraseInputSchema } from "@/server/metadata-contract";
import {
  metadataRead,
  metadataMutation,
  presentPhrase,
} from "@/server/http/metadata-routes";

export const GET = (request: Request) =>
  metadataRead(
    async (owner) => (await listPhrases(owner)).map(presentPhrase),
    request,
  );
export const POST = (request: Request) =>
  metadataMutation(
    request,
    createPhraseInputSchema,
    async (owner, input) => presentPhrase(await createPhrase(owner, input)),
    201,
  );
