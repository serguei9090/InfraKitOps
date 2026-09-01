import { describe, expect, it } from 'vitest'
import { groupTasks, resolveTaskModel } from './taskGroups'
import type { LlmConnection, LlmTask } from './llmModel'

const task = (id: string, extra: Partial<LlmTask> = {}): LlmTask => ({
  id,
  title: id,
  description: '',
  systemTemplate: '',
  outputShape: 'text',
  builtin: true,
  ...extra,
})

describe('groupTasks', () => {
  it('buckets by id prefix, drops empty groups, keeps order', () => {
    const g = groupTasks([task('runbook.assistant'), task('prompt.improve'), task('command.explain')])
    expect(g.map((x) => x.label)).toEqual(['Prompt Library', 'Runbooks', 'Shell & SSH'])
  })

  it('unknown prefixes fall into Other', () => {
    const g = groupTasks([task('prompt.improve'), task('mymodule.dothing')])
    expect(g.map((x) => x.label)).toEqual(['Prompt Library', 'Other / custom'])
    expect(g[1].tasks[0].id).toBe('mymodule.dothing')
  })
})

describe('resolveTaskModel', () => {
  const conns: LlmConnection[] = [
    { id: 'c1', name: 'Local Ollama', provider: 'ollama', baseUrl: '', defaultModel: 'llama3.1:8b', createdAt: 1 },
    { id: 'c2', name: 'OpenAI', provider: 'openai-compatible', baseUrl: '', defaultModel: 'gpt-4o', createdAt: 2 },
  ]

  it('uses the global default when the task pins nothing', () => {
    const r = resolveTaskModel(task('prompt.improve'), conns, { defaultConnectionId: 'c2' })
    expect(r).toMatchObject({ model: 'gpt-4o', connection: 'OpenAI', scope: 'global default' })
  })

  it('a task override wins and is labelled', () => {
    const r = resolveTaskModel(
      task('prompt.improve', { preferredConnectionId: 'c1', preferredModel: 'qwen2.5:7b' }),
      conns,
      { defaultConnectionId: 'c2' },
    )
    expect(r).toMatchObject({ model: 'qwen2.5:7b', connection: 'Local Ollama', scope: 'task override' })
  })

  it('falls back to the first connection with no default', () => {
    const r = resolveTaskModel(task('prompt.improve'), conns, {})
    expect(r.connection).toBe('Local Ollama')
  })
})
