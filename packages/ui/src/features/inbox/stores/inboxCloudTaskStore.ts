interface InboxCloudTaskStoreState {
  isRunning: boolean;
  showConfirm: boolean;
  selectedRepo: string | null;
}

interface InboxCloudTaskStoreActions {
  openConfirm: (defaultRepo: string | null) => void;
  closeConfirm: () => void;
  setSelectedRepo: (repo: string | null) => void;
  setIsRunning: (isRunning: boolean) => void;
}
