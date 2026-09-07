import {
  createWorkTag,
  listWorkTags,
} from "@/server/db/repositories/work-tags";
import { workTagInputSchema } from "@/server/metadata-contract";
import {
  metadataRead,
  metadataMutation,
  presentTag,
} from "@/server/http/metadata-routes";

export const GET = (request: Request) =>
  metadataRead(
    async (owner) => (await listWorkTags(owner)).map(presentTag),
    request,
  );
export const POST = (request: Request) =>
  metadataMutation(
    request,
    workTagInputSchema,
    async (owner, input) => presentTag(await createWorkTag(owner, input)),
    201,
  );
