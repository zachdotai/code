export interface SigningAccessLease {
  socketPath: string;
  gitConfig: Record<string, string>;
  release(): Promise<void>;
}

export interface SigningAccessService {
  acquire(agentId: string): Promise<SigningAccessLease | null>;
}
