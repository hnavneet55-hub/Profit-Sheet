import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { StoreForm } from "../store-form";

export default async function EditStorePage(props: PageProps<"/stores/[id]">) {
  const { id } = await props.params;
  const db = await getDb();
  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, Number(id)));
  if (!store) notFound();
  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">{store.name}</h1>
      <StoreForm store={store} />
    </div>
  );
}
