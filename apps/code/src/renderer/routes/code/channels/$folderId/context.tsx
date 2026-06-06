import { FolderContextView } from "@features/folder-context/components/FolderContextView";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/code/channels/$folderId/context")({
  component: FolderContextRoute,
});

function FolderContextRoute() {
  const { folderId } = Route.useParams();
  return <FolderContextView folderId={folderId} />;
}
