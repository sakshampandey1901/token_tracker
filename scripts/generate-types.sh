#!/usr/bin/env bash
# Regenerate packages/shared/src/database.types.ts from the linked Supabase project.
# Requires: supabase CLI logged in + linked.
set -euo pipefail
cd "$(dirname "$0")/.."
supabase gen types typescript --linked \
  > packages/shared/src/database.types.ts
echo "Wrote packages/shared/src/database.types.ts"
