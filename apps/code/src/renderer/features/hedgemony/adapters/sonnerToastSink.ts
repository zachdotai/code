import { toast } from "sonner";
import type { ToastSink } from "../domain/ToastSink";

export const sonnerToastSink: ToastSink = {
  info(message, options) {
    if (options?.action) {
      toast(message, { action: options.action });
    } else {
      toast(message);
    }
  },
  error(message) {
    toast.error(message);
  },
};
