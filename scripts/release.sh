#!/usr/bin/env bash
# Usage: ./scripts/release.sh <patch|minor|major>
# Bumps package.json version, updates APP_VERSION constants, deploys to Vercel.

set -e

TYPE=${1:-patch}
CURRENT=$(node -p "require('./package.json').version")

# Calculate next version
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"
case "$TYPE" in
  major) MAJOR=$((MAJOR+1)); MINOR=0; PATCH=0 ;;
  minor) MINOR=$((MINOR+1)); PATCH=0 ;;
  patch) PATCH=$((PATCH+1)) ;;
  *) echo "Usage: $0 <patch|minor|major>"; exit 1 ;;
esac
NEXT="$MAJOR.$MINOR.$PATCH"

echo "📦 Bumping $CURRENT → $NEXT"

# 1. Update package.json
sed -i '' "s/\"version\": \"$CURRENT\"/\"version\": \"$NEXT\"/" package.json

# 2. Update APP_VERSION in Topbar and ChangelogViewer
sed -i '' "s/const APP_VERSION = \"$CURRENT\"/const APP_VERSION = \"$NEXT\"/" \
  src/app/Topbar.tsx \
  src/app/changelog/ChangelogViewer.tsx 2>/dev/null || true

# 3. Prompt for CHANGELOG entry
TODAY=$(date '+%Y-%m-%d')
echo ""
echo "✏️  Add release notes to CHANGELOG.md:"
echo "   ## [$NEXT] — $TODAY"
echo ""
echo "   Then run: vercel --prod"
echo ""
echo "✅ Version bumped to $NEXT. Edit CHANGELOG.md and deploy."
