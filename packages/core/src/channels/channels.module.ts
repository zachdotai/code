import { ContainerModule } from "inversify";
import { ChannelsService } from "./channels";
import { CHANNELS_SERVICE } from "./identifiers";

// Host-agnostic channels service. It composes the shared DesktopFsClient (bound
// by the canvas module) + AuthService, so any host that loads the canvas module
// alongside this one can bind it. ChannelLinkService is host-bound (deep-link
// registry + main window) and is bound directly by the desktop app container,
// like the other link services.
export const channelsCoreModule = new ContainerModule(({ bind }) => {
  bind(ChannelsService).toSelf().inSingletonScope();
  bind(CHANNELS_SERVICE).toService(ChannelsService);
});
