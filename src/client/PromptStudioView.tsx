/** Unified prompt-component editor and request-layout preview. */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { HostObservable, InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import {
  DEFAULT_SUPPLEMENT_ORDER,
  buildDraftSystemComponents,
  isNativeOverride,
  nextOverrideId,
  nextSupplementId,
  renderSystemPreview,
  type CapturedContextResource,
  type CapturedPromptComponent,
  type PromptComponent,
  type PromptComponentKind,
  type PromptComponentPosition,
  type PromptComponentRole,
} from '../shared.ts'
import type { PromptStudioState, PromptStudioStore } from './store.ts'
import styles from './PromptStudioView.module.css'

/**
 * Registrant business face supplied by the slot registration. The reserved
 * `hooks` compartment carries the bare snapshot source; the renderer binds it
 * to the component's `useSnapshot` selector hook.
 */
export interface PromptStudioViewInjected {
  controller: PromptStudioStore
  hooks: { snapshot: HostObservable<PromptStudioState> }
}

/** Full conversation-view props after the injected face is composed. */
export type PromptStudioViewProps = ConvViewProps & InjectFace<PromptStudioViewInjected>

/** Settings-page props over the same controller and editor surface. */
export type PromptStudioSettingsSectionProps =
  PropsRuntime<'settings.section'> & InjectFace<PromptStudioViewInjected>

type DisplayRow =
  | { type: 'native'; component: PromptComponent }
  | { type: 'captured'; component: CapturedPromptComponent }
  | { type: 'configured'; component: PromptComponent; configuredIndex: number }

const POSITION_ORDER: Record<PromptComponentPosition, number> = {
  after_system: 0,
  anchored: 1,
  tail: 2,
}

const KIND_LABEL: Record<PromptComponentKind, string> = {
  native: '原生',
  supplement: '补充',
}

const POSITION_LABEL: Record<PromptComponentPosition, string> = {
  after_system: '系统后',
  anchored: '最后用户输入后',
  tail: '请求尾部',
}

const ROLE_LABEL: Record<PromptComponentRole, string> = {
  system: 'system',
  user: 'user',
  assistant: 'assistant',
}

function copyComponents(components: readonly PromptComponent[]): PromptComponent[] {
  return components.map(component => ({ ...component }))
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function rowPlacement(row: DisplayRow): number {
  if (row.type === 'captured') return 1
  if (row.component.role === 'system') return 0
  return 2 + POSITION_ORDER[row.component.position ?? 'tail']
}

function compareRows(left: DisplayRow, right: DisplayRow): number {
  const leftPlacement = rowPlacement(left)
  const rightPlacement = rowPlacement(right)
  return leftPlacement - rightPlacement
    || left.component.order - right.component.order
}

interface PreviewBlock {
  kind: 'system' | 'captured' | 'supplement'
  id?: string
  text: string
  label?: string
}

function previewText(
  systemText: string,
  supplements: readonly PromptComponent[],
  captured: readonly CapturedPromptComponent[],
  userAnchor: number | null,
): PreviewBlock[] {
  const blocks: PreviewBlock[] = []
  if (systemText.length > 0) blocks.push({ kind: 'system', text: systemText })
  const appendSupplements = (position: PromptComponentPosition): void => {
    for (const component of supplements.filter(item => item.position === position)) {
      blocks.push({ kind: 'supplement', id: component.id, text: component.template })
    }
  }
  const appendCaptured = (items: readonly CapturedPromptComponent[]): void => {
    for (const component of items) {
      blocks.push({
        kind: 'captured',
        id: component.id,
        text: component.template,
        label: `${component.producer}${component.form === undefined ? '' : ` · ${component.form}`} · 消息 ${String(component.order + 1)}`,
      })
    }
  }
  appendSupplements('after_system')
  const orderedCaptured = [...captured].sort((left, right) => left.order - right.order)
  if (userAnchor === null) {
    appendCaptured(orderedCaptured)
  } else {
    appendCaptured(orderedCaptured.filter(component => component.order <= userAnchor))
    appendSupplements('anchored')
    appendCaptured(orderedCaptured.filter(component => component.order > userAnchor))
  }
  appendSupplements('tail')
  return blocks
}

interface ResourceDraft {
  resource: CapturedContextResource
  content: string
  digest: string
  saving: boolean
  saved: boolean
  error: string | null
}

function CapturedComponentCard({
  component,
  controller,
}: {
  component: CapturedPromptComponent
  controller: PromptStudioStore
}): ReactNode {
  const [expanded, setExpanded] = useState(false)
  const [loadingResource, setLoadingResource] = useState<string | null>(null)
  const [draft, setDraft] = useState<ResourceDraft | null>(null)

  const editResource = (resource: CapturedContextResource): void => {
    if (!resource.editable || loadingResource !== null) return
    setLoadingResource(resource.id)
    setDraft(null)
    void controller.loadResource(component.id, resource.id)
      .then((snapshot) => {
        setDraft({
          resource,
          content: snapshot.content,
          digest: snapshot.digest,
          saving: false,
          saved: false,
          error: null,
        })
      })
      .catch((error: unknown) => {
        setDraft({ resource, content: '', digest: '', saving: false, saved: false, error: messageOf(error) })
      })
      .finally(() => { setLoadingResource(null) })
  }

  const saveResource = (): void => {
    if (draft === null || draft.saving || draft.digest.length === 0) return
    setDraft(current => current === null ? null : { ...current, saving: true, saved: false, error: null })
    void controller.saveResource(component.id, draft.resource.id, draft.content, draft.digest)
      .then((snapshot) => {
        setDraft(current => current === null ? null : {
          ...current,
          content: snapshot.content,
          digest: snapshot.digest,
          saving: false,
          saved: true,
          error: null,
        })
      })
      .catch((error: unknown) => {
        setDraft(current => current === null ? null : { ...current, saving: false, saved: false, error: messageOf(error) })
      })
  }

  const sourceLabel = `${component.producer} · kind=${component.sourceKind}${component.form === undefined ? '' : ` · form=${component.form}`}`
  const editable = component.resources.filter(resource => resource.editable)
  return (
    <li className={styles['componentCard']} aria-label={`捕获上下文 ${component.id}`}>
      <div className={styles['rowHeader']}>
        <span className={styles['stateBadge']}>自动捕获</span>
        <span className={styles['kindBadge']}>上下文</span>
        <span className={styles['sectionName']}>{sourceLabel}</span>
        <span className={styles['roleBadge']}>{component.role}</span>
        <span className={styles['orderBadge']}>消息位置 {String(component.order + 1)}</span>
        <button type="button" className={styles['textButton']} onClick={() => { setExpanded(value => !value) }}>
          {expanded ? '收起' : '查看'}
        </button>
      </div>
      {component.summary === undefined ? null : <p className={styles['origin']}>{component.summary}</p>}
      {expanded
        ? (
          <>
            <pre className={styles['capturedText']}>{component.template}</pre>
            <details className={styles['sourceDetails']}>
              <summary>来源元数据</summary>
              <pre>{JSON.stringify(component.source, null, 2)}</pre>
            </details>
          </>
        )
        : <p className={styles['excerpt']}>{component.template || '（空内容）'}</p>}
      <div className={styles['resourceActions']}>
        {component.resources.map(resource => resource.editable
          ? (
            <button
              key={resource.id}
              type="button"
              className={styles['textButton']}
              disabled={loadingResource !== null}
              onClick={() => { editResource(resource) }}
            >
              {loadingResource === resource.id ? '正在读取…' : `编辑文件：${resource.path}`}
            </button>
          )
          : <span key={resource.id} className={styles['readonlyResource']}>{resource.path}（{resource.action === 'remove' ? '已移除' : '只读'}）</span>)}
      </div>
      {editable.length === 0
        ? <p className={styles['readonlyNotice']}>只读捕获：来源没有提供可解析的文件变更。</p>
        : null}
      {draft === null
        ? null
        : (
          <div className={styles['resourceEditor']} aria-label={`编辑上下文文件 ${draft.resource.path}`}>
            <div className={styles['resourceEditorHeader']}>
              <strong>{draft.resource.path}</strong>
              <button type="button" className={styles['textButton']} onClick={() => { setDraft(null) }}>关闭</button>
            </div>
            {draft.error === null ? null : <p className={styles['error']}>{draft.error}</p>}
            <textarea
              className={styles['textarea']}
              value={draft.content}
              disabled={draft.digest.length === 0 || draft.saving}
              rows={12}
              onChange={(event) => {
                setDraft(current => current === null ? null : { ...current, content: event.target.value, saved: false })
              }}
            />
            <div className={styles['resourceEditorFooter']}>
              <span className={styles['caption']}>
                {draft.saved ? '已写回；下一轮请求仍由原上下文生产者按其状态机协调。' : '保存只修改来源文件，不改写已进入会话的上下文事件。'}
              </span>
              <button
                type="button"
                className={styles['primaryButton']}
                disabled={draft.digest.length === 0 || draft.saving}
                onClick={saveResource}
              >
                {draft.saving ? '正在写回…' : '写回文件'}
              </button>
            </div>
          </div>
        )}
    </li>
  )
}

/** Conversation-view entry point. */
export function PromptStudioView({ controller, useSnapshot, useSession }: PromptStudioViewProps): ReactNode {
  const requestVersion = useSession(snapshot => `${String(snapshot.sessionId)}:${snapshot.running ? 'running' : 'idle'}:${snapshot.openState}`)
  useEffect(() => { void controller.load() }, [controller, requestVersion])
  return <PromptStudioSurface controller={controller} useSnapshot={useSnapshot} />
}

/** Settings-page entry point sharing the exact live editor state. */
export function PromptStudioSettingsSection({
  controller,
  useSnapshot,
}: PromptStudioSettingsSectionProps): ReactNode {
  useEffect(() => { void controller.load() }, [controller])
  return <PromptStudioSurface controller={controller} useSnapshot={useSnapshot} />
}

function PromptStudioSurface({ controller, useSnapshot }: InjectFace<PromptStudioViewInjected>): ReactNode {
  const remote = useSnapshot(state => state)

  if (remote.status === 'idle' || (remote.status === 'loading' && remote.native.length === 0)) {
    return <div className={styles['status']}>正在载入 Prompt Studio…</div>
  }
  if (remote.status === 'error') {
    return (
      <div className={styles['status']}>
        <p className={styles['error']}>{remote.error}</p>
        <button type="button" className={styles['secondaryButton']} onClick={() => { void controller.load() }}>
          重试
        </button>
      </div>
    )
  }
  return <PromptStudioEditor controller={controller} remote={remote} />
}

function PromptStudioEditor({
  controller,
  remote,
}: {
  controller: PromptStudioStore
  remote: PromptStudioState
}): ReactNode {
  const [draft, setDraft] = useState<PromptComponent[]>(() => copyComponents(remote.components))
  const [dirty, setDirty] = useState(false)
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    setDraft(copyComponents(remote.components))
    setDirty(false)
    setSaving(false)
    setSaveError(null)
    setEditingIndex(index => index !== null && index < remote.components.length ? index : null)
  }, [remote.catalogRevision, remote.components, remote.revision])

  const rows = useMemo<DisplayRow[]>(() => [
    ...remote.native.map(component => ({ type: 'native' as const, component })),
    ...remote.captured.map(component => ({ type: 'captured' as const, component })),
    ...draft.map((component, configuredIndex) => ({ type: 'configured' as const, component, configuredIndex })),
  ].sort(compareRows), [draft, remote.captured, remote.native])

  const draftSystem = useMemo(
    () => dirty ? buildDraftSystemComponents(remote.native, draft) : copyComponents(remote.assembled),
    [dirty, draft, remote.assembled, remote.native],
  )
  const requestSupplements = useMemo(() => {
    const nativeIds = new Set(remote.native.map(component => component.id))
    return draft.filter(component => component.enabled
      && component.role !== 'system'
      && (!isNativeOverride(component) || nativeIds.has(component.origin)))
  }, [draft, remote.native])
  const orderedRequestSupplements = useMemo(() => requestSupplements
    .map((component, declaration) => ({ component, declaration }))
    .sort((left, right) => POSITION_ORDER[left.component.position ?? 'tail'] - POSITION_ORDER[right.component.position ?? 'tail']
      || left.component.order - right.component.order
      || left.declaration - right.declaration)
    .map(entry => entry.component), [requestSupplements])
  const systemContent = useMemo(() => renderSystemPreview(draftSystem), [draftSystem])
  const preview = useMemo(
    () => previewText(systemContent, orderedRequestSupplements, remote.captured, remote.userAnchor),
    [orderedRequestSupplements, remote.captured, remote.userAnchor, systemContent],
  )

  const changeComponent = (index: number, patch: Partial<PromptComponent>): void => {
    setDraft(current => current.map((component, position) => position === index
      ? { ...component, ...patch }
      : component))
    setDirty(true)
    setSaveError(null)
  }

  const changeOrigin = (index: number, origin: string): void => {
    setDraft(current => current.map((component, position) => {
      if (position !== index) return component
      const next = { ...component }
      if (origin.length === 0) delete next.origin
      else next.origin = origin
      return next
    }))
    setDirty(true)
    setSaveError(null)
  }

  const changeRole = (index: number, role: PromptComponentRole): void => {
    setDraft(current => current.map((component, position) => {
      if (position !== index) return component
      const next: PromptComponent = { ...component, role }
      if (role === 'system') delete next.position
      else next.position ??= 'after_system'
      if (role !== 'assistant') delete next.blockType
      return next
    }))
    setDirty(true)
    setSaveError(null)
  }

  const addSupplement = (): void => {
    setDraft((current) => {
      const next = [...current, {
        id: nextSupplementId(current),
        kind: 'supplement' as const,
        position: 'tail' as const,
        role: 'user' as const,
        order: DEFAULT_SUPPLEMENT_ORDER,
        enabled: true,
        template: '',
      }]
      setEditingIndex(next.length - 1)
      return next
    })
    setDirty(true)
    setSaveError(null)
  }

  const addOverride = (native: PromptComponent): void => {
    const existing = draft.findIndex(component => isNativeOverride(component) && component.origin === native.id)
    if (existing >= 0) {
      setEditingIndex(existing)
      return
    }
    setDraft((current) => {
      const next = [...current, {
        id: nextOverrideId(current, native.id),
        kind: 'supplement' as const,
        role: 'system' as const,
        order: native.order,
        enabled: true,
        template: native.template,
        origin: native.id,
      }]
      setEditingIndex(next.length - 1)
      return next
    })
    setDirty(true)
    setSaveError(null)
  }

  const removeComponent = (index: number): void => {
    setDraft(current => current.filter((_component, position) => position !== index))
    setEditingIndex((current) => {
      if (current === null || current === index) return null
      return current > index ? current - 1 : current
    })
    setDirty(true)
    setSaveError(null)
  }

  const save = (): void => {
    if (!dirty || saving || !remote.writable) return
    setSaving(true)
    setSaveError(null)
    void controller.save(draft, remote.revision)
      .catch((error: unknown) => { setSaveError(messageOf(error)) })
      .finally(() => { setSaving(false) })
  }

  return (
    <div className={styles['root']}>
      <div className={styles['pageHeader']}>
        <div>
          <h1 className={styles['title']}>Prompt Studio</h1>

        </div>
        <div className={styles['headerActions']}>
          <button type="button" className={styles['secondaryButton']} disabled={!remote.writable} onClick={addSupplement}>
            新增补充
          </button>
          <button
            type="button"
            className={styles['primaryButton']}
            disabled={!dirty || saving || !remote.writable}
            onClick={save}
          >
            {saving ? '正在保存…' : '保存更改'}
          </button>
        </div>
      </div>

      {!remote.writable ? <p className={styles['notice']}>当前设置提供方为只读。</p> : null}
      {remote.status === 'loading' ? <p className={styles['notice']}>正在刷新运行时组件…</p> : null}
      {saveError !== null ? <p className={styles['error']}>{saveError}</p> : null}

      <div className={styles['columns']}>
        <section className={styles['editorColumn']} aria-label="统一提示词组件">
          <div className={styles['sectionHeading']}>
            <div>
              <h2 className={styles['subtitle']}>组件</h2>

            </div>
            <span className={styles['count']}>{String(rows.length)}</span>
          </div>

          <ol className={styles['componentList']}>
            {rows.map((row) => {
              if (row.type === 'captured') {
                return <CapturedComponentCard key={row.component.id} component={row.component} controller={controller} />
              }
              const { component } = row
              const configuredIndex = row.type === 'configured' ? row.configuredIndex : -1
              const isNative = row.type === 'native'
              const editing = !isNative && editingIndex === configuredIndex
              const override = isNativeOverride(component)
              const overrideExists = isNative && draft.some(item => isNativeOverride(item) && item.origin === component.id)
              return (
                <li key={`${component.kind}:${component.id}:${String(configuredIndex)}`} className={styles['componentCard']}>
                  <div className={styles['rowHeader']}>
                    {isNative
                      ? <span className={styles['stateBadge']}>运行时</span>
                      : (
                        <label className={styles['enabledControl']}>
                          <input
                            type="checkbox"
                            checked={component.enabled}
                            disabled={!remote.writable}
                            onChange={(event) => { changeComponent(configuredIndex, { enabled: event.target.checked }) }}
                          />
                          <span>{component.enabled ? '启用' : override ? '关闭原生' : '停用'}</span>
                        </label>
                      )}
                    <span className={styles['kindBadge']}>{KIND_LABEL[component.kind]}</span>
                    <span className={styles['sectionName']}>{component.id}</span>
                    {component.position === undefined
                      ? null
                      : <span className={styles['positionBadge']}>{POSITION_LABEL[component.position]}</span>}
                    <span className={styles['roleBadge']}>{component.role}</span>
                    <span className={styles['orderBadge']}>
                      {component.role === 'system' ? '层级' : '间隙内顺序'} {String(component.order)}
                    </span>
                    {isNative
                      ? (
                        <button
                          type="button"
                          className={styles['textButton']}
                          disabled={!remote.writable}
                          onClick={() => { addOverride(component) }}
                        >
                          {overrideExists ? '编辑覆盖' : '创建覆盖'}
                        </button>
                      )
                      : (
                        <>
                          <button
                            type="button"
                            className={styles['textButton']}
                            onClick={() => { setEditingIndex(editing ? null : configuredIndex) }}
                          >
                            {editing ? '收起' : '编辑'}
                          </button>
                          <button
                            type="button"
                            className={styles['dangerButton']}
                            disabled={!remote.writable}
                            onClick={() => { removeComponent(configuredIndex) }}
                          >
                            {override ? '恢复原生' : '删除'}
                          </button>
                        </>
                      )}
                  </div>

                  {component.origin !== undefined
                    ? <p className={styles['origin']}>覆盖目标：{component.origin}</p>
                    : null}

                  {editing
                    ? (
                      <div className={styles['componentEditor']}>
                        <label className={styles['field']}>
                          <span className={styles['fieldLabel']}>标识</span>
                          <input
                            className={styles['input']}
                            value={component.id}
                            disabled={!remote.writable}
                            onChange={(event) => { changeComponent(configuredIndex, { id: event.target.value }) }}
                          />
                        </label>
                        <label className={styles['field']}>
                          <span className={styles['fieldLabel']}>
                            {component.role === 'system' ? '系统层级' : '间隙内顺序'}
                          </span>
                          <input
                            className={styles['orderInput']}
                            type="number"
                            value={component.order}
                            disabled={!remote.writable}
                            onChange={(event) => { changeComponent(configuredIndex, { order: Number(event.target.value) }) }}
                          />
                        </label>
                        {component.role === 'system'
                          ? null
                          : (
                            <label className={styles['field']}>
                              <span className={styles['fieldLabel']}>消息间隙</span>
                              <select
                                className={styles['select']}
                                value={component.position}
                                disabled={!remote.writable}
                                onChange={(event) => { changeComponent(configuredIndex, { position: event.target.value as PromptComponentPosition }) }}
                              >
                                {Object.entries(POSITION_LABEL).map(([value, label]) => (
                                  <option key={value} value={value}>{label}</option>
                                ))}
                              </select>
                            </label>
                          )}
                        <label className={styles['field']}>
                          <span className={styles['fieldLabel']}>角色</span>
                          <select
                            className={styles['select']}
                            value={component.role}
                            disabled={!remote.writable}
                            onChange={(event) => { changeRole(configuredIndex, event.target.value as PromptComponentRole) }}
                          >
                            {Object.entries(ROLE_LABEL).map(([value, label]) => (
                              <option key={value} value={value}>{label}</option>
                            ))}
                          </select>
                        </label>
                        {component.role === 'assistant'
                          ? (
                            <label className={styles['field']}>
                              <span className={styles['fieldLabel']}>块类型</span>
                              <select
                                className={styles['select']}
                                value={component.blockType ?? 'text'}
                                disabled={!remote.writable}
                                onChange={(event) => { changeComponent(configuredIndex, { blockType: event.target.value as 'text' | 'reasoning' }) }}
                              >
                                <option value="text">文本</option>
                                <option value="reasoning">思考</option>
                              </select>
                            </label>
                          )
                          : null}
                        <label className={styles['field']}>
                          <span className={styles['fieldLabel']}>覆盖目标</span>
                          <select
                            className={styles['select']}
                            value={component.origin ?? ''}
                            disabled={!remote.writable}
                            onChange={(event) => { changeOrigin(configuredIndex, event.target.value) }}
                          >
                            <option value="">不覆盖原生</option>
                            {remote.native.map(item => <option key={item.id} value={item.id}>{item.id}</option>)}
                          </select>
                        </label>
                        <label className={`${styles['field']} ${styles['templateField']}`}>
                          <span className={styles['fieldLabel']}>模板</span>
                          <textarea
                            className={styles['textarea']}
                            value={component.template}
                            disabled={!remote.writable}
                            rows={8}
                            onChange={(event) => { changeComponent(configuredIndex, { template: event.target.value }) }}
                          />
                        </label>
                      </div>
                    )
                    : <p className={styles['excerpt']}>{component.template || '（空模板）'}</p>}
                </li>
              )
            })}
          </ol>
        </section>

        <section className={styles['previewColumn']} aria-label="完整请求预览">
          <div className={styles['sectionHeading']}>
            <div>
              <h2 className={styles['subtitle']}>完整预览</h2>

            </div>
            <span className={styles['count']}>
              {String(preview.length)}
            </span>
          </div>
          <div className={styles['assemblyOrder']}>
            {preview.map((block, index) => (
              <span key={`layout:${block.kind}:${block.id ?? 'system'}:${String(index)}`} className={styles['assemblyRow']}>
                <span className={styles['assemblyIndex']}>{String(index + 1)}</span>
                <span>{block.kind === 'system' ? 'system' : block.kind === 'captured' ? '自动捕获' : '补充'}</span>
                <span className={styles['assemblyOrderValue']}>{block.label ?? (block.kind === 'system' ? `${String(draftSystem.length)} 个 section 合并` : '')}</span>
              </span>
            ))}
          </div>
          <div className={styles['preview']}>
            {preview.map((block, index) => (
              block.kind === 'system'
                ? <pre key={`system:${index}`} className={styles['previewSystem']}>{block.text}</pre>
                : (
                  <div key={`${block.kind}:${block.id}:${index}`} className={block.kind === 'captured' ? styles['previewCaptured'] : styles['previewSupplement']}>
                    <span className={styles['previewSupplementTag']}>{block.kind === 'captured' ? block.label : '补充'}</span>
                    <pre className={styles['previewSupplementText']}>{block.text}</pre>
                  </div>
                )
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
