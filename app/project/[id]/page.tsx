import Workspace from "@/components/Workspace";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Workspace projectId={id} />;
}
