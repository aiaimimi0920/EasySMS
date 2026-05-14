# Development Workflow

This document records the shared development workflow for the EasyAiMi service
repositories in this workspace.

## Active Development Repository

Develop the SMS migration line in:

- `C:\Users\Public\nas_home\AI\GameEditor\EasySms`

Legacy repositories remain reference-only. They may be used for code borrowing,
migration comparison, and behavior lookup, but they are not write targets for
ongoing implementation work.

## Architecture Contract

- `EasySms` is the capability service for public SMS acquisition and inbox
  reads.
- `service/base` owns the HTTP runtime.
- `runtimes/userscript` owns the browser-native operator helper runtime.
- When a behavior fails, first identify whether the issue belongs to the
  service runtime, the browser runtime, or deployment packaging, then patch the
  owning area in this new repository.

## Daily Iteration Workflow

Use this loop for normal development:

1. Edit the owning area in `EasySms`.
2. Build locally.
3. Test locally.
4. Run isolated local Docker validation when the change affects runtime or
   deploy behavior.

During rapid iteration, do not use GitHub Actions as the primary test loop.

## Final Release Validation

After local build, test, and runtime validation are stable, run one final
release-grade verification:

1. Build through GitHub Actions.
2. Publish to GHCR.
3. Pull the GHCR image locally.
4. Run the target scenario locally from the pulled image.
5. Confirm the result is acceptable.
