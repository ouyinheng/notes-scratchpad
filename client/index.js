import React from 'react';

// cbd-purge · CodeBuddy Web 面板
// 宿主侧（hooks/index.js）通过 engine.create 暴露 cbdPurge 名词，
// 这里只用 host.call('cbdPurge', method, [args]) 读写，不碰任何内部服务。

export const inject = ['slots', 'locale', 'settings'];

const NS = 'cbd-purge';
const CSS = [
  '.cbdp{font:inherit;color:var(--color-text-primary);border:1px solid var(--color-border-default);border-radius:10px;background:var(--color-bg-panel,var(--color-bg-input));margin:8px 16px;overflow:hidden}',
  '.cbdp-bar{display:flex;align-items:center;gap:8px;padding:8px 12px;flex-wrap:wrap}',
  '.cbdp-dot{width:8px;height:8px;border-radius:50%;background:var(--color-text-tertiary);flex:none}',
  '.cbdp-dot.on{background:#22c55e;box-shadow:0 0 6px #22c55e88}',
  '.cbdp-dot.warn{background:#f59e0b}',
  '.cbdp-name{font-weight:600}',
  '.cbdp-meta{color:var(--color-text-secondary);font-size:12px}',
  '.cbdp-grow{flex:1 1 auto}',
  '.cbdp button{font:inherit;font-size:13px;border:1px solid var(--color-border-default);border-radius:8px;padding:4px 10px;background:var(--color-bg-input);color:inherit;cursor:pointer}',
  '.cbdp button:hover:not(:disabled){background:var(--color-bg-hover)}',
  '.cbdp button:disabled{opacity:.45;cursor:default}',
  '.cbdp button.primary{background:#22c55e1a;border-color:#22c55e66}',
  '.cbdp button.danger{background:#ef44441a;border-color:#ef444466}',
  '.cbdp-body{padding:4px 12px 12px;display:flex;flex-direction:column;gap:10px;border-top:1px solid var(--color-border-default)}',
  '.cbdp-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
  '.cbdp label{font-size:12px;color:var(--color-text-secondary);display:flex;gap:6px;align-items:center}',
  '.cbdp select,.cbdp textarea{font:inherit;font-size:13px;color:inherit;background:var(--color-bg-input);border:1px solid var(--color-border-default);border-radius:8px;padding:6px 8px}',
  '.cbdp textarea{width:100%;min-height:150px;max-height:44vh;resize:vertical;font-family:var(--font-mono,ui-monospace,monospace);font-size:12px;line-height:1.5}',
  '.cbdp-preview{max-height:180px;overflow:auto;white-space:pre-wrap;font-size:12px;line-height:1.5;color:var(--color-text-secondary);border:1px dashed var(--color-border-default);border-radius:8px;padding:8px}',
  '.cbdp-err{color:#ef4444;font-size:12px;white-space:pre-wrap}',
  '.cbdp-tag{font-size:11px;padding:1px 6px;border-radius:999px;border:1px solid var(--color-border-default);color:var(--color-text-secondary)}',
].join('');

const TEXT = {
  zh: {
    title: '破甲',
    on: '注入中',
    off: '已关闭',
    open: '面板',
    close: '收起',
    enable: '开启',
    disable: '关闭',
    preset: '预设',
    prompt: '破甲正文',
    save: '保存正文',
    reset: '退回预设',
    saved: '已保存',
    perTurn: '每轮锚点',
    workspace: '工作区指令',
    wsOff: '不改动',
    wsKeep: '保留',
    wsReplace: '清洗',
    bypass: '本会话绕过审批',
    harden: '落盘加固',
    revert: '回滚加固',
    preview: '预览注入',
    bytes: '{n} 字节',
    mode: '权限模式 {mode}',
    sandbox: '沙箱 {state}',
    sandboxOn: '开',
    sandboxOff: '关',
    applied: '加固已生效',
    notApplied: '加固未生效',
    failed: '操作失败',
    resetDone: '已退回预设文件',
    previewEmpty: '没有可注入的正文',
  },
  en: {
    title: 'Purge',
    on: 'Injecting',
    off: 'Off',
    open: 'Panel',
    close: 'Collapse',
    enable: 'Enable',
    disable: 'Disable',
    preset: 'Preset',
    prompt: 'Payload',
    save: 'Save payload',
    reset: 'Use preset',
    saved: 'Saved',
    perTurn: 'Per-turn anchor',
    workspace: 'Workspace files',
    wsOff: 'Leave alone',
    wsKeep: 'Keep',
    wsReplace: 'Strip',
    bypass: 'Bypass approvals (session)',
    harden: 'Harden settings',
    revert: 'Revert hardening',
    preview: 'Preview injection',
    bytes: '{n} bytes',
    mode: 'permission mode {mode}',
    sandbox: 'sandbox {state}',
    sandboxOn: 'on',
    sandboxOff: 'off',
    applied: 'Hardened',
    notApplied: 'Not hardened',
    failed: 'Operation failed',
    resetDone: 'Preset restored',
    previewEmpty: 'Nothing to inject',
  },
};

const h = React.createElement;

function call(method, args) {
  return host.call('cbdPurge', method, args ?? []);
}

export function apply(ctx) {
  styles.insert(CSS);
  ctx.locale.register(NS, TEXT);

  ctx.slots.register({ name: 'chat.composer.before', id: 'cbd-purge', label: '破甲' }, function PurgePanel() {
    const t = ctx.locale.useT(NS);
    const [status, setStatus] = React.useState(null);
    const [open, setOpen] = React.useState(false);
    const [busy, setBusy] = React.useState('');
    const [error, setError] = React.useState('');
    const [draft, setDraft] = React.useState('');
    const [presetId, setPresetId] = React.useState('');
    const [presetList, setPresetList] = React.useState([]);
    const [preview, setPreview] = React.useState('');
    const [note, setNote] = React.useState('');

    const refresh = React.useCallback(async () => {
      try {
        const [next, list] = await Promise.all([call('status'), call('presets')]);
        setStatus(next);
        setPresetList(Array.isArray(list) ? list : []);
        setPresetId((current) => current || next?.prompt?.presetId || '');
      } catch (failure) {
        setError(String(failure?.message ?? failure));
      }
    }, []);

    React.useEffect(() => {
      refresh();
    }, [refresh]);

    const run = async (key, fn) => {
      setBusy(key);
      setError('');
      setNote('');
      try {
        await fn();
        await refresh();
      } catch (failure) {
        setError(String(failure?.message ?? failure));
      } finally {
        setBusy('');
      }
    };

    const enabled = !!status?.enabled;
    const promptBytes = status?.prompt?.bytes ?? 0;
    const hard = status?.hardening ?? {};
    const cfg = status?.inject ?? {};
    const ws = status?.workspace ?? {};

    const patch = (body) => run('patch', async () => {
      const next = await call('patch', [{ patch: body }]);
      setStatus(next);
    });

    return h(
      'section',
      { className: 'cbdp' },
      h(
        'div',
        { className: 'cbdp-bar' },
        h('span', { className: enabled ? 'cbdp-dot on' : 'cbdp-dot' }),
        h('span', { className: 'cbdp-name' }, t('title')),
        h('span', { className: 'cbdp-meta' }, enabled ? t('on') : t('off')),
        h('span', { className: 'cbdp-tag' }, `${status?.prompt?.presetId ?? '—'} · ${t('bytes', { n: promptBytes })}`),
        hard?.active
          ? h('span', { className: 'cbdp-tag' }, t('applied'))
          : h('span', { className: 'cbdp-tag' }, t('notApplied')),
        h('span', { className: 'cbdp-grow' }),
        h(
          'button',
          {
            type: 'button',
            className: enabled ? 'danger' : 'primary',
            disabled: busy === 'toggle',
            onClick: () => run('toggle', async () => {
              const next = await call('patch', [{ patch: { enabled: !enabled } }]);
              setStatus(next);
            }),
          },
          enabled ? t('disable') : t('enable'),
        ),
        h(
          'button',
          {
            type: 'button',
            disabled: busy === 'harden',
            onClick: () => run('harden', async () => {
              const result = await call('apply');
              setNote(result?.status?.hardening?.active ? t('applied') : '');
            }),
          },
          t('harden'),
        ),
        h('button', { type: 'button', onClick: () => setOpen((value) => !value) }, open ? t('close') : t('open')),
      ),
      error ? h('div', { className: 'cbdp-body' }, h('div', { className: 'cbdp-err' }, `${t('failed')}: ${error}`)) : null,
      open
        ? h(
            'div',
            { className: 'cbdp-body' },
            status
              ? h(
                  'div',
                  { className: 'cbdp-row cbdp-meta' },
                  h('span', null, t('mode', { mode: hard?.defaultMode ?? 'default' })),
                  h('span', null, '·'),
                  h('span', null, t('sandbox', { state: hard?.sandboxEnabled ? t('sandboxOn') : t('sandboxOff') })),
                  h('span', null, '·'),
                  h('span', null, `${(ws?.files ?? []).length} workspace md`),
                  note ? h('span', { className: 'cbdp-tag' }, note) : null,
                )
              : null,
            h(
              'div',
              { className: 'cbdp-row' },
              h('label', null, t('preset')),
              h(
                'select',
                {
                  value: presetId,
                  onChange: (event) => setPresetId(event.target.value),
                },
                ...presetList.map((item) =>
                  h('option', { key: `${item.source}:${item.id}`, value: item.id }, `${item.id}${item.source === 'user' ? ' *' : ''}`),
                ),
              ),
              h(
                'button',
                {
                  type: 'button',
                  disabled: busy === 'preset' || !presetId,
                  onClick: () => run('preset', async () => {
                    const next = await call('patch', [{ patch: { presetId, promptText: null } }]);
                    setStatus(next);
                  }),
                },
                t('prompt'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  disabled: busy === 'load',
                  onClick: () => run('load', async () => {
                    const body = await call('preset', [{ id: presetId }]);
                    setDraft(body?.text ?? '');
                  }),
                },
                '↧',
              ),
              h(
                'label', null,
                h('input', {
                  type: 'checkbox',
                  checked: cfg?.perTurn !== false,
                  onChange: (event) => patch({ inject: { perTurn: event.target.checked } }),
                }),
                t('perTurn'),
              ),
              h(
                'label', null,
                t('workspace'),
                h(
                  'select',
                  {
                    value: ws?.policy ?? 'replace',
                    onChange: (event) => patch({ workspace: { policy: event.target.value } }),
                  },
                  h('option', { value: 'replace' }, t('wsReplace')),
                  h('option', { value: 'keep' }, t('wsKeep')),
                  h('option', { value: 'off' }, t('wsOff')),
                ),
              ),
            ),
            h('textarea', {
              value: draft,
              placeholder: t('prompt'),
              onChange: (event) => setDraft(event.target.value),
            }),
            h(
              'div',
              { className: 'cbdp-row' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'primary',
                  disabled: busy === 'save' || !draft.trim(),
                  onClick: () => run('save', async () => {
                    const next = await call('savePrompt', [{ text: draft }]);
                    setStatus(next);
                    setNote(t('saved'));
                  }),
                },
                t('save'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  disabled: busy === 'reset',
                  onClick: () => run('reset', async () => {
                    const next = await call('savePrompt', [{ text: '' }]);
                    setStatus(next);
                    setDraft('');
                    setNote(t('resetDone'));
                  }),
                },
                t('reset'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  disabled: busy === 'bypass',
                  onClick: () => run('bypass', async () => {
                    await ctx.settings.setPermissionMode('bypassPermissions');
                    setNote('bypassPermissions');
                  }),
                },
                t('bypass'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  disabled: busy === 'preview',
                  onClick: () => run('preview', async () => {
                    const body = await call('preview');
                    setPreview(body?.text || t('previewEmpty'));
                  }),
                },
                t('preview'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  disabled: busy === 'probe',
                  onClick: () => run('probe', async () => {
                    const body = await call('probe');
                    setPreview(JSON.stringify(body, null, 2));
                  }),
                },
                '自检',
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'danger',
                  disabled: busy === 'revert',
                  onClick: () => run('revert', async () => {
                    await call('revert');
                    setNote('');
                  }),
                },
                t('revert'),
              ),
            ),
            preview ? h('div', { className: 'cbdp-preview' }, preview.slice(0, 6000)) : null,
            status?.lastInject
              ? h(
                  'div',
                  { className: 'cbdp-meta' },
                  `last inject: ${status.lastInject.presetId} · ${status.lastInject.bytes}B · ${status.lastInject.at}`,
                )
              : null,
          )
        : null,
    );
  });
}
