#!/usr/bin/env bash
set -euo pipefail

# Regenerate types
cd rust
cargo test -p glue-paste-dev-core --quiet
cd ..

# Fail if any generated file differs from the committed copy
if ! git diff --exit-code packages/dashboard/src/types/generated; then
  echo "ERROR: generated TypeScript types are out of sync with Rust types."
  echo "Run 'cargo test -p glue-paste-dev-core' and commit the changes under"
  echo "packages/dashboard/src/types/generated/."
  exit 1
fi
