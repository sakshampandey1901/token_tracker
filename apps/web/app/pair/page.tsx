import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PairClient } from "./pair-client";

export const dynamic = "force-dynamic";

export default async function PairPage({
  searchParams,
}: {
  searchParams: { editor?: string; auto?: string };
}) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/pair?editor=${searchParams.editor ?? "vscode"}`);

  const editor = searchParams.editor === "cursor" ? "cursor" : "vscode";
  const auto = searchParams.auto !== "0";

  return <PairClient editor={editor} autoStart={auto} email={user.email ?? ""} />;
}
