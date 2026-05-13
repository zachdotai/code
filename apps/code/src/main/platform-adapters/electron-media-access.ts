import type {
  IMediaAccess,
  MediaAccessStatus,
} from "@posthog/platform/media-access";
import { systemPreferences } from "electron";
import { injectable } from "inversify";

@injectable()
export class ElectronMediaAccess implements IMediaAccess {
  public getMicrophoneStatus(): MediaAccessStatus {
    if (process.platform !== "darwin") return "granted";
    return systemPreferences.getMediaAccessStatus(
      "microphone",
    ) as MediaAccessStatus;
  }

  public async requestMicrophoneAccess(): Promise<boolean> {
    if (process.platform !== "darwin") return true;
    return systemPreferences.askForMediaAccess("microphone");
  }
}
