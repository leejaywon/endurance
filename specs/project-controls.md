# Project controls

The native desktop project settings use separate General, Connections, Project instructions, Requests, and Evaluations views. The chat and model picker keep their existing layout. Settings and records are stored outside the repository with user-only file permissions. Settings follow canonical project directories and their descendants; nested projects can override them.

## Files and connections

General includes Source folders & Agent Access: a lazy directory tree of the working folder and connected source folders. Every row shows its selected permission icon and label; hovering or focusing reveals the three permission buttons with tooltips. Folder restrictions are inherited by descendants, including newly created files. A child cannot weaken a parent rule. Source roots themselves can be changed between Read & write, Read only, and No access. Existing source roots without an explicit access value retain Read only. Missing-folder status appears on the affected row. Tree expansion loads at most 200 entries at a time and does not follow symbolic links outside each source root. These user-facing metadata reads never enter model context.

Desktop Settings includes Privacy & Security. New-project access, added-folder access, and external processing for new projects are saved as global defaults. Initial defaults are Read & write, Read only, and enabled, respectively. Project policies are persisted on first use (including opening a project); changing defaults first snapshots known projects under the old defaults. Already persisted policies stay unchanged. Newly selected source folders receive the current added-folder default and remain editable before saving project settings. Unknown folders opened as projects for the first time receive the then-current defaults.

No access blocks file reads, attachments and edits. Read only blocks writes and replacement of protected parents. Glob and grep pass excluded paths to ripgrep before traversal, rather than disabling search altogether. Directory reads filter excluded entries. Legacy wildcard exclusions fail closed until replaced with concrete files or folders.

When a project has file restrictions or source folders, command execution uses the macOS sandbox automatically. Read-only and excluded paths become filesystem denials, including for child processes. File restrictions alone do not disable model providers or command networking. The previous full-isolation mode still denies command networking and remote processing. File restrictions cannot confine arbitrary in-process plugins or independent MCP servers, so those integrations are unavailable while restrictions apply. This limitation is disclosed under Connections. LSPs retain the legacy full-isolation gate and use the shared process spawner for newly started processes.

Connections contains External processing and direct model/tool connection selection. Provider allowlists apply to chat and desktop transcription. Optional approved addresses compare the configured provider origin. Agent permissions cannot override project restrictions. Authentication remains owned by existing credential storage. File restrictions do not silently enable previously blocked commands or connections; prior command blocks remain visible in Advanced. Switching away from legacy full isolation is explicit and preserves remote-processing denial.

External processing is project-wide. There is no per-fragment provenance tracking, so the UI does not offer per-file external-transfer guarantees. The Requests view owns request-body retention; connection tuning and address restrictions are under Advanced.

Settings govern subsequent work. Already-running processes and previously loaded extensions require a project/server restart; settings cannot retract data already sent. This is not a machine-wide security perimeter. Provider origin checks do not police redirects, custom provider transports, or a local server forwarding data elsewhere. Platforms without the macOS sandbox reject restricted process execution rather than falling back. Existing tool approval flows remain in place; this change does not implement a new temporary network/path-grant broker or a conversation-level read-only mode.

## Request history

Policy decisions record time, model, provider, origin, and rejection reason. Request bodies are retained only when enabled; authentication headers are not recorded. Records are capped at 100 entries and expire after 30 days when history is read or written. Individual records can be deleted. These are request admission records, not delivery receipts or a complete network capture. Transcription records contain audio size and language rather than audio bytes.

## Instructions and evaluations

Project instructions are edited and deleted explicitly by the user and included in subsequent model requests. There is no automatic memory extraction.

Compare response forks a question into a chat with tools disabled. Evaluations keeps Cases and Runs inside project settings. Cases contain a task, optional reference material and reference answer, and review criteria. Existing cases and result files remain readable; new runs no longer apply legacy exact/contains scoring.

Run one case or the project case set with one to five repeats. Each result stores a run ID, case snapshot, project policy snapshot, target model, session ID, response, and target execution time. Runs can be compared side by side. Case or project-setting differences are disclosed. The runner stops scheduling when project settings change and marks an in-flight result as an execution error if it detects a change after execution. This is snapshot recording and change detection, not an immutable provider deployment: external model weights, provider configuration, and concurrent transient changes are not locked.

Review defaults to the user. An optional review model receives the task, references, criteria, and response through the same project-controlled model path. It produces pass/fail/uncertain suggestions per criterion with a reason and a verbatim candidate excerpt where applicable. Invalid JSON, mismatched criteria, and invented excerpts produce a review error while preserving the target response. Model judgments are suggestions; human acceptance/rejection and notes are stored separately. No automatic overall pass is assigned to unreviewed, uncertain, or errored reviews. Execution errors are separate from quality verdicts.

The runner uses text inputs and disables tools. It does not execute code tests, replay arbitrary agent workflows, inspect workspace files automatically, or prove the truth of claims in reference material. Runs continue only while this renderer component is mounted; closing it cancels the active request. Completed results are saved individually. Execution history persists, but durable resumption after closing the app is not implemented.

## Local resources

Local provider requests use a cancellable queue per endpoint in the server process. Project settings choose a concurrency limit. The managed speech worker queues requests and unloads after five idle minutes. The existing Ollama model manager includes Release memory, using Ollama's unload operation without deleting model files. Other applications and servers retain control over their own GPU allocation; these controls do not impose a machine-wide memory quota.

## Verification

Automated tests and benchmarks were skipped at the user's request. App, core, legacy server, and desktop typechecks passed. The server and desktop development bundles were rebuilt and the development app restarted. The General and Connections screens were inspected through the running Electron renderer; the missing working folder is an inline error rather than a fatal renderer error. The desktop IPC returned the real repository directory entries. No saved user policies were changed during this inspection. macOS sandbox enforcement and real provider requests were not exercised.

## Permission failures and continuation

Denied calls carry a permission-specific explanation and the requested resources, rather than claiming the target is missing or empty. Every provider turn includes a fresh project-policy snapshot, and tool admission checks current permissions. Read-only denial of a write does not prevent later reads or independent work.

The harness tracks rejected operations by session, normalized action and canonical path, grouped under the denying parent boundary where available. Three denials of the same operation and boundary under an unchanged policy switch the next provider turn to a tool-free summary. Additional calls after that threshold are rejected before tool execution. New user turns and policy changes reset the bookkeeping. The summary turn is bounded, so a provider returning further tool calls cannot sustain the continuation loop. This bookkeeping is process-local and bounded to 1,000 sessions; existing filesystem checks and sandbox restrictions remain the enforcement mechanism, including for alternate tool paths.

This is not a general parser for shell permission failures: OS errors without a structured permission decision do not contribute to the per-resource counter. Existing running processes keep their original sandbox until they finish or are restarted; changing settings does not force-kill them. Typechecks and a server build validate integration; automated tests and live model calls remain skipped at the user's request.
