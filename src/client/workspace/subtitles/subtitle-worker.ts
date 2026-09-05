import { subtitleWorkerRequestSchema } from "./contracts";
import {
  invalidWorkerMessageResponse,
  createSubtitleProcessor,
} from "./processor";

const processSubtitleFiles = createSubtitleProcessor();

self.addEventListener("message", (event: MessageEvent<unknown>) => {
  const parsed = subtitleWorkerRequestSchema.safeParse(event.data);
  const response = parsed.success
    ? processSubtitleFiles(parsed.data)
    : invalidWorkerMessageResponse();
  self.postMessage(response);
});
