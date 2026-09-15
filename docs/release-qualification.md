# Authenticated release preparation

The old independent Windows/Linux publishing paths are retired. They previously allowed unsigned or partial platform releases. `release.yml` now tests the reviewed commit, audits production dependencies, builds macOS, Windows, Linux x64 and Linux arm64, verifies platform signatures, attests exact distribution files, verifies those attestations, and creates a **draft** only when every build succeeds. It does not publish automatically.

macOS needs `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`. Windows needs `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD`. These are repository secrets, not source files. Native platform builds set `forceCodeSigning`; notarization/Authenticode verification failures block artifacts. Certificate availability was not assumed or fabricated, and this workflow was not dispatched during implementation.

Linux artifacts, and all other release files, receive GitHub OIDC/Sigstore build attestations. This is authenticated build provenance; it is not a substitute for Windows/macOS OS signing, human source review or physical-device qualification. The workflow requires `id-token: write` and `attestations: write` only in the artifact-building job.

Before installing a downloaded file:

```sh
node scripts/verify-release.cjs ./Aspen-linux-x64.AppImage FULL_REVIEWED_COMMIT_SHA
```

The helper invokes GitHub's maintained verifier and checks the exact bytes, repository, workflow, source commit and hosted-runner provenance. Obtain the commit through a trusted review/release channel. Do not accept a commit solely because an untrusted download page supplies it. On macOS/Windows also verify the operating system's publisher signature. Automatic Windows/Linux updates remain disabled until the complete upgrade/rollback path is qualified.

`npm run release:mac` remains useful for preparing a locally signed Mac build. It checks the requested version against the committed package version, runs tests, builds without publishing, and validates the staple. It no longer overwrites source files, commits/pushes main, modifies “latest”, publishes a partial release or starts unverified downstream builds.

Sources: [GitHub artifact attestations](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations), [verification flags](https://cli.github.com/manual/gh_attestation_verify). GitHub connector migration uses the [official hosted MCP endpoint](https://github.com/github/github-mcp-server/blob/main/docs/remote-server.md). The spreadsheet dependency uses the [maintainer's supported distribution](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/).
