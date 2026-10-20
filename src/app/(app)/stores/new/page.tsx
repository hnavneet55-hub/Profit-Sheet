import { StoreForm } from "../store-form";

export default function NewStorePage() {
  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">Add store</h1>
      <StoreForm />
    </div>
  );
}
