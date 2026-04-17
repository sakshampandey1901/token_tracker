import { DemoDashboard } from "@/components/demo-dashboard";

// Zero-setup preview: renders the real UI with synthetic data.
// Useful for `pnpm dev:web` right after clone, without any Supabase config.
export const dynamic = "force-static";

export default function DemoPage() {
  return <DemoDashboard />;
}
