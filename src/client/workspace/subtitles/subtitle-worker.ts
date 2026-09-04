import { subtitleWorkerRequestSchema } from "./contracts";
import {
  invalidWorkerMessageResponse,
  processSubtitleFiles,
} from "./processor";

self.addEventListener("message", (event: MessageEvent<unknown>) => {
  const parsed = subtitleWorkerRequestSchema.safeParse(event.data);
  const response = parsed.success
    ? processSubtitleFiles(parsed.data)
    : invalidWorkerMessageResponse();
  self.postMessage(response);
});
