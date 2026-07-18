import { MemoryView } from "@/features/memory/components/MemoryView";

interface MemoryPageProps {
  memoryId?: string;
}

export function MemoryPage(props: MemoryPageProps) {
  return <MemoryView {...props} />;
}
