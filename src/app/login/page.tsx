import { LoginForm } from "./form";

export default async function LoginPage(props: PageProps<"/login">) {
  const { next } = await props.searchParams;
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="card w-full max-w-sm p-6">
        <h1 className="mb-4 text-lg font-semibold">Profit Sheet</h1>
        <LoginForm next={typeof next === "string" ? next : "/"} />
      </div>
    </div>
  );
}
