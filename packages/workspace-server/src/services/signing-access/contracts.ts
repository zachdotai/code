export interface SigningAccessLease {
  socketPath: string;
  gitConfig: Record<string, string>;
  release(): Promise<void>;
}

export interface SigningAccessStatus {
  supported: boolean;
  enabled: boolean;
  publicKey: string | null;
  error: string | null;
}

export interface SigningAccessService {
  getStatus(): Promise<SigningAccessStatus>;
  setEnabled(enabled: boolean): Promise<SigningAccessStatus>;
  acquire(agentId: string): Promise<SigningAccessLease | null>;
}
