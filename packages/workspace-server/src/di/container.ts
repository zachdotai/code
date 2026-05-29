import "reflect-metadata";
import { Container } from "inversify";
import { FocusService } from "../services/focus/service";
import { FocusSyncService } from "../services/focus/sync-service";
import { FsService } from "../services/fs/service";
import { GitService } from "../services/git/service";
import { WatcherService } from "../services/watcher/service";
import { TOKENS } from "./tokens";

export const container = new Container();
container.bind(TOKENS.FocusService).to(FocusService).inSingletonScope();
container.bind(TOKENS.FocusSyncService).to(FocusSyncService).inSingletonScope();
container.bind(TOKENS.GitService).to(GitService).inSingletonScope();
container.bind(TOKENS.FsService).to(FsService).inSingletonScope();
container.bind(TOKENS.WatcherService).to(WatcherService).inSingletonScope();
