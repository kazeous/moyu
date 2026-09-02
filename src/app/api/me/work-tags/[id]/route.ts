import {
  findWorkTagById,
  updateWorkTag,
  deleteWorkTag,
} from "@/server/db/repositories/work-tags";
import { workTagInputSchema } from "@/server/metadata-contract";
import {
  metadataRead,
  metadataMutation,
  metadataDelete,
  presentTag,
  presentFound,
  detailId,
  type DetailContext,
} from "@/server/http/metadata-routes";

export const GET = (request: Request, context: DetailContext) =>
  metadataRead(
    async (owner) =>
      presentFound(
        await findWorkTagById(owner, await detailId(context)),
        presentTag,
      ),
    request,
  );
export const PUT = (request: Request, context: DetailContext) =>
  metadataMutation(request, workTagInputSchema, async (owner, input) =>
    presentFound(
      await updateWorkTag(owner, await detailId(context), input),
      presentTag,
    ),
  );
export const DELETE = (request: Request, context: DetailContext) =>
  metadataDelete(request, async (owner) =>
    deleteWorkTag(owner, await detailId(context)),
  );
