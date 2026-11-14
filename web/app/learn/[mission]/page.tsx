import { notFound } from "next/navigation";
import ExploreApp from "@/components/ExploreApp";
import { MISSIONS } from "@/content/missions";

export function generateStaticParams() {
  return MISSIONS.filter((m) => m.ready).map((m) => ({ mission: m.id }));
}

export default async function MissionPage({ params }: { params: Promise<{ mission: string }> }) {
  const { mission } = await params;
  const m = MISSIONS.find((x) => x.id === mission && x.ready);
  if (!m) notFound();
  return <ExploreApp missionId={m.id} />;
}
