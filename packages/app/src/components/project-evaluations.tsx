import { createMemo, createResource, For, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { TextareaV2 } from "@opencode-ai/ui/v2/textarea-v2"
import { usePlatform } from "@/context/platform"
import { useLanguage } from "@/context/language"
import { useProviders } from "@/hooks/use-providers"
import { showToast } from "@/utils/toast"
import { EvaluationCase, type EvaluationResult } from "@opencode-ai/core/project-controls/schema"
import type { createEditProjectModel } from "./edit-project"
import { evaluateCase } from "./project-evaluation"

export function ProjectEvaluations(props: { model: ReturnType<typeof createEditProjectModel>; directory: string }) {
  const language = useLanguage()
  const platform = usePlatform().projectControls!
  const providers = useProviders(() => props.directory)
  const [cases, caseActions] = createResource(() => platform.cases(props.directory))
  const [results, resultActions] = createResource(() => platform.results(props.directory))
  const [state, setState] = createStore({
    tab: "cases",
    target: "",
    judge: "",
    repeat: 1,
    running: false,
    finished: 0,
    total: 0,
    run: "",
    baseline: "",
    draft: undefined as EvaluationCase | undefined,
    criteria: "",
    note: "",
    reviewID: "",
  })
  let controller: AbortController | undefined
  onCleanup(() => controller?.abort())
  const models = createMemo(() =>
    providers
      .connected()
      .flatMap((provider) =>
        Object.values(provider.models).map((model) => ({
          key: JSON.stringify([provider.id, model.id]),
          id: model.id,
          providerID: provider.id,
          name: `${provider.name} / ${model.name}`,
        })),
      ),
  )
  const runs = createMemo(() =>
    [...new Set((results() ?? []).map((result) => result.runID ?? result.id))].map((id) => {
      const items = (results() ?? []).filter((result) => (result.runID ?? result.id) === id)
      return { id, items, label: `${items[0].model} · ${new Date(items[0].time).toISOString()}` }
    }),
  )
  const selected = () => runs().find((run) => run.id === state.run) ?? runs()[0]
  const baseline = () => runs().find((run) => run.id === state.baseline && run.id !== selected()?.id)
  const failure = (error: unknown) =>
    showToast({
      title: language.t("common.requestFailed"),
      description: error instanceof Error ? error.message : String(error),
    })
  const save = async () => {
    const item = EvaluationCase.parse({
      ...state.draft,
      criteria: state.criteria
        .split("\n")
        .map((value) => value.trim())
        .filter(Boolean),
      match: "review",
      time: Date.now(),
    })
    await platform.saveCase(props.directory, item)
    await caseActions.refetch()
    setState("draft", undefined)
  }
  const run = async (items: EvaluationCase[]) => {
    const model = models().find((model) => model.key === state.target)
    const judge = models().find((model) => model.key === state.judge)
    if (!model || state.running || !items.length) return
    const snapshot = items.map((item) => EvaluationCase.parse(item))
    const id = crypto.randomUUID()
    controller = new AbortController()
    const signal = controller.signal
    setState({ running: true, finished: 0, total: snapshot.length * state.repeat, tab: "runs", run: id })
    try {
      await props.model.saveControls()
      const policy = JSON.stringify(await platform.read(props.directory))
      const jobs = Array.from({ length: state.repeat }, () => snapshot).flat()
      for (const item of jobs) {
        if (signal.aborted) break
        if (JSON.stringify(await platform.read(props.directory)) !== policy)
          throw new Error(language.t("project.evals.changed"))
        const result = await evaluateCase({
          sdk: props.model.sdk(),
          controls: platform,
          directory: props.directory,
          item,
          model,
          judge,
          signal,
          runID: id,
        })
        if (JSON.stringify(await platform.read(props.directory)) !== policy) {
          result.error = language.t("project.evals.changed")
          result.passed = null
        }
        await platform.saveResult(props.directory, result)
        setState("finished", (value) => value + 1)
        await resultActions.refetch()
      }
    } catch (error) {
      if (!signal.aborted) failure(error)
    } finally {
      setState("running", false)
    }
  }
  const review = async (result: EvaluationResult, verdict: "pass" | "fail" | "unreviewed") => {
    await platform.saveResult(props.directory, { ...result, review: { verdict, note: state.note, time: Date.now() } })
    await resultActions.refetch()
    setState("reviewID", "")
  }
  const status = (result: EvaluationResult) =>
    result.error
      ? language.t("project.evals.error")
      : result.review
        ? language.t(
            result.review.verdict === "pass"
              ? "project.evals.accepted"
              : result.review.verdict === "fail"
                ? "project.evals.rejected"
                : "project.evals.unreviewed",
          )
        : result.assessments
          ? language.t(
              result.passed === true
                ? "project.evals.suggestedPass"
                : result.passed === false
                  ? "project.evals.suggestedFail"
                  : "project.evals.uncertain",
            )
          : language.t("project.evals.unreviewed")
  return (
    <div class="flex flex-col gap-5">
      <div class="flex gap-2">
        <For each={["cases", "runs"]}>
          {(tab) => (
            <ButtonV2
              type="button"
              variant={state.tab === tab ? "neutral" : "ghost-muted"}
              onClick={() => setState("tab", tab)}
            >
              {language.t(tab === "cases" ? "project.evals.cases" : "project.evals.runs")}
            </ButtonV2>
          )}
        </For>
      </div>
      <Show when={cases.error || results.error}>
        <p role="alert">{language.t("common.requestFailed")}</p>
      </Show>
      <Show when={state.running}>
        <div class="flex items-center justify-between">
          <span>
            {state.finished} / {state.total}
          </span>
          <ButtonV2 type="button" variant="neutral" onClick={() => controller?.abort()}>
            {language.t("project.records.cancel")}
          </ButtonV2>
        </div>
      </Show>
      <Show when={state.tab === "cases"}>
        <p class="text-12-regular text-text-weak">{language.t("project.evals.scope")}</p>
        <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <label class="flex flex-col gap-2">
            {language.t("project.evals.target")}
            <SelectV2
              options={models()}
              current={models().find((model) => model.key === state.target)}
              value={(model) => model.key}
              label={(model) => model.name}
              disabled={state.running}
              onSelect={(model) => model && setState("target", model.key)}
            />
          </label>
          <label class="flex flex-col gap-2">
            {language.t("project.evals.reviewer")}
            <SelectV2
              options={[{ key: "", name: language.t("project.evals.manual") }, ...models()]}
              current={[{ key: "", name: language.t("project.evals.manual") }, ...models()].find(
                (model) => model.key === state.judge,
              )}
              value={(model) => model.key}
              label={(model) => model.name}
              disabled={state.running}
              onSelect={(model) => model && setState("judge", model.key)}
            />
          </label>
        </div>
        <Show when={state.judge}>
          <p class="text-12-regular text-text-weak">{language.t("project.evals.judgeHint")}</p>
        </Show>
        <div class="flex flex-wrap items-center gap-3">
          <label class="flex items-center gap-2">
            {language.t("project.evals.repeat")}
            <SelectV2
              options={[1, 2, 3, 5]}
              current={state.repeat}
              value={String}
              label={String}
              disabled={state.running}
              onSelect={(value) => value && setState("repeat", value)}
            />
          </label>
          <ButtonV2
            type="button"
            variant="contrast"
            disabled={state.running || !state.target || !cases()?.length || !!cases.error || !!state.draft}
            onClick={() => void run(cases() ?? [])}
          >
            {language.t("project.evals.runAll")}
          </ButtonV2>
          <ButtonV2
            type="button"
            variant="neutral"
            disabled={state.running || !!state.draft}
            onClick={() =>
              setState({
                draft: {
                  id: crypto.randomUUID(),
                  time: Date.now(),
                  name: "",
                  prompt: "",
                  expected: "",
                  criteria: [],
                  context: "",
                  match: "review",
                },
                criteria: "",
              })
            }
          >
            {language.t("project.records.newCase")}
          </ButtonV2>
        </div>
        <For each={cases.error ? [] : (cases() ?? [])}>
          {(item) => (
            <div class="flex items-center gap-2 border-b border-border-weak-base pb-3">
              <ButtonV2
                type="button"
                variant="ghost-muted"
                class="min-w-0 flex-1 !justify-start"
                disabled={state.running}
                onClick={() => setState({ draft: { ...item }, criteria: item.criteria.join("\n") })}
              >
                {item.name}
              </ButtonV2>
              <ButtonV2
                type="button"
                variant="neutral"
                disabled={state.running || !state.target || !!state.draft}
                onClick={() => void run([item])}
              >
                {language.t("project.records.run")}
              </ButtonV2>
              <ButtonV2
                type="button"
                variant="ghost-muted"
                disabled={state.running}
                onClick={() =>
                  void platform
                    .removeRecord(props.directory, "cases", item.id)
                    .then(() => caseActions.refetch())
                    .catch(failure)
                }
              >
                {language.t("common.delete")}
              </ButtonV2>
            </div>
          )}
        </For>
        <Show when={state.draft}>
          {(draft) => (
            <div class="flex flex-col gap-4">
              <label class="flex flex-col gap-2">
                {language.t("project.records.name")}
                <TextInputV2
                  class="!w-full"
                  value={draft().name}
                  onInput={(event) => setState("draft", "name", event.currentTarget.value)}
                />
              </label>
              <label class="flex flex-col gap-2">
                {language.t("project.evals.task")}
                <TextareaV2
                  class="!w-full"
                  rows={4}
                  value={draft().prompt}
                  onInput={(event) => setState("draft", "prompt", event.currentTarget.value)}
                />
              </label>
              <label class="flex flex-col gap-2">
                {language.t("project.evals.context")}
                <TextareaV2
                  class="!w-full"
                  rows={4}
                  value={draft().context}
                  onInput={(event) => setState("draft", "context", event.currentTarget.value)}
                />
              </label>
              <label class="flex flex-col gap-2">
                {language.t("project.evals.criteria")}
                <TextareaV2
                  class="!w-full"
                  rows={4}
                  placeholder={language.t("project.evals.criteriaExample")}
                  value={state.criteria}
                  onInput={(event) => setState("criteria", event.currentTarget.value)}
                />
              </label>
              <label class="flex flex-col gap-2">
                {language.t("project.evals.reference")}
                <TextareaV2
                  class="!w-full"
                  rows={3}
                  value={draft().expected}
                  onInput={(event) => setState("draft", "expected", event.currentTarget.value)}
                />
              </label>
              <div class="flex gap-2">
                <ButtonV2
                  type="button"
                  variant="contrast"
                  disabled={!draft().name.trim() || !draft().prompt.trim()}
                  onClick={() => void save().catch(failure)}
                >
                  {language.t("common.save")}
                </ButtonV2>
                <ButtonV2 type="button" variant="neutral" onClick={() => setState("draft", undefined)}>
                  {language.t("common.cancel")}
                </ButtonV2>
              </div>
            </div>
          )}
        </Show>
      </Show>
      <Show when={state.tab === "runs"}>
        <Show when={runs().length} fallback={<p class="text-text-weak">{language.t("project.records.empty")}</p>}>
          <label class="flex flex-col gap-2">
            {language.t("project.evals.run")}
            <SelectV2
              options={runs()}
              current={selected()}
              value={(run) => run.id}
              label={(run) => run.label}
              onSelect={(run) => run && setState("run", run.id)}
            />
          </label>
          <label class="flex flex-col gap-2">
            {language.t("project.evals.compare")}
            <SelectV2
              options={[
                { id: "", label: language.t("project.evals.none") },
                ...runs().filter((run) => run.id !== selected()?.id),
              ]}
              current={baseline() ?? { id: "", label: language.t("project.evals.none") }}
              value={(run) => run.id}
              label={(run) => run.label}
              onSelect={(run) => run && setState("baseline", run.id)}
            />
          </label>
          <For each={selected()?.items}>
            {(result) => (
              <section class="flex flex-col gap-3 border-t border-border-weak-base pt-4">
                <div class="flex items-start justify-between gap-3">
                  <h3 class="text-14-medium">{result.caseName ?? result.caseID}</h3>
                  <span class="text-12-regular">{status(result)}</span>
                </div>
                <div class={baseline() ? "grid grid-cols-1 lg:grid-cols-2 gap-4" : ""}>
                  <div class="min-w-0">
                    <p class="text-text-weak text-12-regular">
                      {result.model} · {(result.duration / 1000).toFixed(1)}s
                    </p>
                    <pre class="max-h-80 overflow-auto whitespace-pre-wrap break-words text-13-regular">
                      {result.error ?? result.output}
                    </pre>
                  </div>
                  <Show when={baseline()}>
                    <div class="min-w-0">
                      <For
                        each={baseline()?.items.filter((item) => item.caseID === result.caseID)}
                        fallback={<p>{language.t("project.evals.missing")}</p>}
                      >
                        {(other) => (
                          <div class="mb-4">
                            <p class="text-text-weak text-12-regular">
                              {other.model} · {status(other)}
                            </p>
                            <Show
                              when={
                                JSON.stringify(other.snapshot) !== JSON.stringify(result.snapshot) ||
                                JSON.stringify(other.policy) !== JSON.stringify(result.policy)
                              }
                            >
                              <p class="text-12-regular">{language.t("project.evals.different")}</p>
                            </Show>
                            <pre class="max-h-80 overflow-auto whitespace-pre-wrap break-words text-13-regular">
                              {other.error ?? other.output}
                            </pre>
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>
                <Show when={result.judge}>
                  <p class="text-12-regular text-text-weak">
                    {language.t("project.evals.reviewer")}: {result.judge?.providerID} / {result.judge?.id}
                  </p>
                </Show>
                <Show when={result.judgeError}>
                  <p role="alert" class="text-12-regular">
                    {result.judgeError}
                  </p>
                </Show>
                <For each={result.assessments}>
                  {(item) => (
                    <div class="text-13-regular">
                      <p>
                        {item.criterion} ·{" "}
                        {language.t(
                          item.verdict === "pass"
                            ? "project.records.pass"
                            : item.verdict === "fail"
                              ? "project.records.fail"
                              : "project.evals.uncertain",
                        )}
                      </p>
                      <p class="text-text-weak">{item.reason}</p>
                      <Show when={item.evidence}>
                        <blockquote class="border-l border-border-weak-base pl-3 whitespace-pre-wrap">
                          {item.evidence}
                        </blockquote>
                      </Show>
                    </div>
                  )}
                </For>
                <Show when={result.review}>
                  <p class="whitespace-pre-wrap text-13-regular">{result.review?.note}</p>
                </Show>
                <details>
                  <summary class="cursor-pointer text-12-regular">{language.t("project.evals.savedInput")}</summary>
                  <pre class="max-h-72 overflow-auto whitespace-pre-wrap break-words text-12-regular">
                    {JSON.stringify(
                      {
                        task: result.prompt,
                        referenceMaterial: result.snapshot?.context,
                        referenceAnswer: result.expected,
                        criteria: result.snapshot?.criteria,
                        instructions: result.policy?.memory,
                      },
                      null,
                      2,
                    )}
                  </pre>
                </details>
                <div class="flex gap-2">
                  <ButtonV2
                    type="button"
                    variant="neutral"
                    disabled={!!result.error}
                    onClick={() =>
                      setState({
                        reviewID: state.reviewID === result.id ? "" : result.id,
                        note: result.review?.note ?? "",
                      })
                    }
                  >
                    {language.t("project.evals.review")}
                  </ButtonV2>
                  <ButtonV2
                    type="button"
                    variant="ghost-muted"
                    disabled={state.running}
                    onClick={() =>
                      void platform
                        .removeRecord(props.directory, "results", result.id)
                        .then(() => resultActions.refetch())
                        .catch(failure)
                    }
                  >
                    {language.t("common.delete")}
                  </ButtonV2>
                </div>
                <Show when={state.reviewID === result.id}>
                  <TextareaV2
                    class="!w-full"
                    rows={2}
                    aria-label={language.t("project.evals.note")}
                    placeholder={language.t("project.evals.note")}
                    value={state.note}
                    onInput={(event) => setState("note", event.currentTarget.value)}
                  />
                  <div class="flex gap-2">
                    <For each={["pass", "fail", "unreviewed"] as const}>
                      {(verdict) => (
                        <ButtonV2
                          type="button"
                          variant="neutral"
                          onClick={() => void review(result, verdict).catch(failure)}
                        >
                          {language.t(
                            verdict === "pass"
                              ? "project.evals.accepted"
                              : verdict === "fail"
                                ? "project.evals.rejected"
                                : "project.evals.unreviewed",
                          )}
                        </ButtonV2>
                      )}
                    </For>
                  </div>
                </Show>
              </section>
            )}
          </For>
        </Show>
      </Show>
    </div>
  )
}
