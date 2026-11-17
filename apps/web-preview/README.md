# ASCEND browser preview

A single-page browser version of ASCEND for trying the product without setting up Supabase or Expo.
It runs the same domain logic as the mobile app (`packages/domain`: scheduler, habit rules, recurrence,
quick-capture parser, goal progress), compiled into the page.

- Build: `npm run preview:build` → `apps/web-preview/dist/ascend-preview.html`
- Data: when opened as a claude.ai artifact, records are stored privately per viewer
  (`data/users/<id>`); elsewhere they fall back to this browser's storage.
- It is separate from the mobile app's data and does not sync with Supabase.
