import { fetchLabCards } from "@/actions/labs";
import { LabGrid } from "./LabGrid";

const INITIAL = 20;

export default async function HomePage() {
  const { cards, total } = await fetchLabCards(0, INITIAL);

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-background px-8 py-8">
      <LabGrid initialCards={cards} total={total} />
    </div>
  );
}
