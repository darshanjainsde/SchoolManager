This directory is deliberately empty.

`library-api` ships no static assets — every route is served by the single ncc
bundle at `api/index.js`. But `vercel.json` declares a `buildCommand`, and when
a build runs on a project with no framework preset, Vercel then looks for an
output directory and fails the whole deployment with:

    No Output Directory named "public" found after the Build completed.

The sibling `apps/api` carries the same empty `public/` for the same reason.
Deleting this directory will break the deploy in a way no local build catches.
