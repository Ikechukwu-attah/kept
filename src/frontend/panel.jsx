/**
 * Promises issue panel (UI Kit).
 *  - On a support request: every promise the agents made to this customer, as cards.
 *  - On a dev issue: the customer promises that depend on it ("reverse view").
 */
import React, { useEffect, useState, useCallback } from 'react';
import ForgeReconciler, {
  Box, Button, ButtonGroup, EmptyState, Em, Heading, Icon, Inline, Link, Lozenge, Modal, ModalBody, ModalFooter,
  ModalHeader, ModalTitle, ModalTransition, SectionMessage, Spinner, Stack, Strong, Text, TextArea, xcss,
} from '@forge/react';
import { invoke } from '@forge/bridge';

const STATUS = {
  open: { label: 'Open', appearance: 'inprogress' },
  at_risk: { label: 'At risk', appearance: 'moved' },
  ready: { label: 'Ready to close the loop', appearance: 'new' },
  kept: { label: 'Kept', appearance: 'success' },
  broken: { label: 'Broken', appearance: 'removed' },
  dismissed: { label: 'Not a promise', appearance: 'default' },
};
const KIND = {
  update: { label: 'Update', icon: 'email' },
  fix: { label: 'Fix', icon: 'bug' },
  refund: { label: 'Refund', icon: 'shortcut' },
  callback: { label: 'Callback', icon: 'person' },
  action: { label: 'Action', icon: 'arrow-right' },
};
const ACTIVE = ['open', 'at_risk', 'ready'];

const card = (status) =>
  xcss({
    padding: 'space.150',
    borderRadius: 'border.radius.200',
    borderWidth: 'border.width',
    borderStyle: 'solid',
    borderColor:
      status === 'at_risk' ? 'color.border.warning' : status === 'broken' ? 'color.border.danger' : status === 'ready' ? 'color.border.discovery' : 'color.border',
    backgroundColor: ACTIVE.includes(status) || status === 'broken' ? 'elevation.surface' : 'color.background.neutral.subtle',
  });
const summaryBar = xcss({ padding: 'space.100', borderRadius: 'border.radius.100', backgroundColor: 'color.background.neutral' });

/** Countdown text and colour: red when overdue or due within a day. */
function countdown(dueAt) {
  if (!dueAt) return null;
  const diff = dueAt - Date.now();
  const abs = Math.abs(diff);
  const days = Math.floor(abs / 86400000);
  const hours = Math.round((abs % 86400000) / 3600000);
  const span = days >= 1 ? `${days}d ${hours}h` : `${Math.max(Math.round(abs / 3600000), 1)}h`;
  if (diff < 0) return { text: `${span} overdue`, color: 'color.text.danger' };
  return { text: `due in ${span}`, color: diff < 86400000 ? 'color.text.danger' : diff < 2 * 86400000 ? 'color.text.warning' : 'color.text.subtle' };
}

const fmt = (ms) => new Date(ms).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
function formatDue(p) {
  if (!p.dueAt) return p.dueLabel;
  return p.dueSource === 'default' ? `${fmt(p.dueAt)} (no date given, defaulted)` : fmt(p.dueAt);
}

const PromiseCard = ({ p, mode, onChanged, onDraft }) => {
  const [busy, setBusy] = useState(false);
  const act = async (op, extra = {}) => {
    setBusy(true);
    const res = await invoke('updatePromise', { id: p.id, op, ...extra });
    setBusy(false);
    if (res?.promise) onChanged(res.promise);
  };
  const st = STATUS[p.status] || STATUS.open;
  const kind = KIND[p.kind] || KIND.action;
  const active = ACTIVE.includes(p.status);
  const cd = active ? countdown(p.dueAt) : null;

  return (
    <Box xcss={card(p.status)}>
      <Stack space="space.100">
        <Inline space="space.100" alignBlock="center" spread="space-between" shouldWrap>
          <Inline space="space.100" alignBlock="center">
            <Icon glyph={kind.icon} label={kind.label} size="small" />
            <Strong>{kind.label}</Strong>
            <Lozenge appearance={st.appearance} isBold={p.status === 'at_risk' || p.status === 'broken'}>{st.label}</Lozenge>
            {mode === 'dev' ? <Link href={`/browse/${p.issueKey}`}>{p.issueKey}</Link> : null}
          </Inline>
          {cd ? <Text size="small" weight="semibold" color={cd.color}>{cd.text}</Text> : null}
        </Inline>

        <Text size="large">“{p.quote}”</Text>

        {(p.status === 'at_risk' || p.status === 'ready' || p.status === 'broken') && p.reason ? (
          <SectionMessage appearance={p.status === 'ready' ? 'success' : p.status === 'broken' ? 'error' : 'warning'}>
            <Text>{p.reason}</Text>
          </SectionMessage>
        ) : null}

        <Inline space="space.150" shouldWrap alignBlock="center">
          <Inline space="space.050" alignBlock="center">
            <Icon glyph="calendar" label="Due" size="small" />
            <Text size="small" color="color.text.subtle">{formatDue(p)}</Text>
          </Inline>
          <Inline space="space.050" alignBlock="center">
            <Icon glyph="person" label="Owner" size="small" />
            <Text size="small" color="color.text.subtle">{p.ownerName}</Text>
          </Inline>
          {mode === 'dev' && p.customerName ? <Text size="small" color="color.text.subtle">Customer: {p.customerName}</Text> : null}
          {mode !== 'dev' && p.devIssueKey ? (
            <Inline space="space.050" alignBlock="center">
              <Icon glyph="bug" label="Depends on" size="small" />
              <Link href={`/browse/${p.devIssueKey}`}>{p.devIssueKey}</Link>
            </Inline>
          ) : null}
        </Inline>

        {!active ? <Text size="small" color="color.text.subtle"><Em>{p.reason}</Em></Text> : null}

        {mode !== 'dev' && (active || p.status === 'broken' || p.status === 'dismissed') ? (
          <ButtonGroup>
            {p.status === 'ready' || p.status === 'at_risk' ? (
              <Button appearance="primary" iconBefore="email" isDisabled={busy} onClick={() => onDraft(p)}>Tell customer</Button>
            ) : null}
            {active ? <Button isDisabled={busy} onClick={() => act('kept')}>Mark kept</Button> : null}
            {active || p.status === 'broken' ? <Button isDisabled={busy} onClick={() => act('extend', { days: 2 })}>Extend 2 days</Button> : null}
            {active ? <Button appearance="subtle" isDisabled={busy} onClick={() => act('dismiss')}>Not a promise</Button> : null}
            {p.status === 'dismissed' ? <Button appearance="subtle" isDisabled={busy} onClick={() => act('reopen')}>Undo</Button> : null}
          </ButtonGroup>
        ) : null}
      </Stack>
    </Box>
  );
};

const DraftModal = ({ promise, onClose }) => {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    invoke('draftReply', { id: promise.id }).then((r) => setText(r?.text || ''));
  }, [promise.id]);
  const send = async () => {
    setSending(true);
    const r = await invoke('sendReply', { id: promise.id, text });
    setSending(false);
    if (r?.error) setError(r.error);
    else onClose(true);
  };
  return (
    <Modal onClose={() => onClose(false)} width="medium">
      <ModalHeader>
        <ModalTitle>Reply to customer</ModalTitle>
      </ModalHeader>
      <ModalBody>
        <Stack space="space.150">
          <Text size="small" color="color.text.subtle">Draft from Kept. Review it, then send it as yourself; it posts as a public reply on {promise.issueKey}.</Text>
          <TextArea value={text} onChange={(e) => setText(e.target.value)} resize="vertical" minimumRows={8} />
          {error ? <SectionMessage appearance="error"><Text>{error}</Text></SectionMessage> : null}
        </Stack>
      </ModalBody>
      <ModalFooter>
        <Button appearance="subtle" onClick={() => onClose(false)}>Cancel</Button>
        <Button appearance="primary" isDisabled={sending || !text.trim()} onClick={send}>{sending ? 'Sending…' : 'Send reply'}</Button>
      </ModalFooter>
    </Modal>
  );
};

const App = () => {
  const [data, setData] = useState(null);
  const [drafting, setDrafting] = useState(null);
  const load = useCallback(() => invoke('getPanel').then(setData), []);
  useEffect(() => {
    load();
  }, [load]);

  if (!data) return <Spinner label="Loading promises" />;
  if (data.error) return <SectionMessage appearance="error"><Text>{data.error}</Text></SectionMessage>;

  if (data.mode === 'empty') {
    return (
      <EmptyState
        header="No promises yet"
        description="When an agent replies to the customer with a commitment, like “I’ll update you by Thursday”, Kept tracks it here until it is kept."
      />
    );
  }

  const promises = data.promises;
  const open = promises.filter((p) => ACTIVE.includes(p.status));
  const done = promises.filter((p) => !ACTIVE.includes(p.status));
  const atRisk = promises.filter((p) => p.status === 'at_risk').length;
  const ready = promises.filter((p) => p.status === 'ready').length;
  const broken = promises.filter((p) => p.status === 'broken').length;
  const kept = promises.filter((p) => p.status === 'kept').length;
  const next = open.filter((p) => p.dueAt).sort((a, b) => a.dueAt - b.dueAt)[0];
  const customers = new Set(promises.map((p) => p.issueKey)).size;
  const onChanged = (updated) => setData({ ...data, promises: promises.map((p) => (p.id === updated.id ? updated : p)) });

  return (
    <Stack space="space.150">
      {data.mode === 'dev' ? (
        <SectionMessage appearance={atRisk ? 'warning' : 'information'} title={`${open.length} customer promise${open.length === 1 ? ' depends' : 's depend'} on this issue`}>
          <Text>
            Promised on {customers} support request{customers === 1 ? '' : 's'}. Moving this issue out of its sprint or release puts them at risk, and resolving it lets the agents close the loop.
          </Text>
        </SectionMessage>
      ) : (
        <Box xcss={summaryBar}>
          <Inline space="space.150" alignBlock="center" shouldWrap>
            <Inline space="space.075" alignBlock="center">
              <Icon glyph="check-circle" label="" size="small" />
              <Strong>{open.length} open</Strong>
            </Inline>
            {atRisk ? <Lozenge appearance="moved" isBold>{atRisk} at risk</Lozenge> : null}
            {ready ? <Lozenge appearance="new" isBold>{ready} ready to close the loop</Lozenge> : null}
            {broken ? <Lozenge appearance="removed" isBold>{broken} broken</Lozenge> : null}
            {kept ? <Lozenge appearance="success">{kept} kept</Lozenge> : null}
            {next ? (
              <Inline space="space.050" alignBlock="center">
                <Icon glyph="clock" label="" size="small" />
                <Text size="small">Next due {fmt(next.dueAt)}</Text>
              </Inline>
            ) : null}
          </Inline>
        </Box>
      )}

      {open.map((p) => (
        <PromiseCard key={p.id} p={p} mode={data.mode} onChanged={onChanged} onDraft={setDrafting} />
      ))}

      {done.length ? (
        <Stack space="space.100">
          <Heading as="h5">Resolved ({done.length})</Heading>
          {done.map((p) => (
            <PromiseCard key={p.id} p={p} mode={data.mode} onChanged={onChanged} onDraft={setDrafting} />
          ))}
        </Stack>
      ) : null}

      <ModalTransition>
        {drafting ? (
          <DraftModal
            promise={drafting}
            onClose={(sent) => {
              setDrafting(null);
              if (sent) setTimeout(load, 3000);
            }}
          />
        ) : null}
      </ModalTransition>
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
