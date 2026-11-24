/**
 * Promises issue panel (UI Kit).
 *  - On a support request: every promise the agents made to this customer.
 *  - On a dev issue: the customer promises that depend on it ("reverse view").
 */
import React, { useEffect, useState, useCallback } from 'react';
import ForgeReconciler, {
  Box, Button, ButtonGroup, EmptyState, Heading, Inline, Link, Lozenge, Modal, ModalBody, ModalFooter,
  ModalHeader, ModalTitle, ModalTransition, SectionMessage, Spinner, Stack, Text, TextArea, Em, Strong,
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
const KIND = { update: 'Update', fix: 'Fix', refund: 'Refund', callback: 'Callback', action: 'Action' };
const ACTIVE = ['open', 'at_risk', 'ready'];

/** "due in 2 days" / "overdue by 3 hours" relative to now. */
function relative(dueAt) {
  if (!dueAt) return '';
  const diff = dueAt - Date.now();
  const abs = Math.abs(diff);
  const unit = abs >= 86400000 ? ['day', 86400000] : ['hour', 3600000];
  const n = Math.max(1, Math.round(abs / unit[1]));
  const s = `${n} ${unit[0]}${n > 1 ? 's' : ''}`;
  return diff >= 0 ? `due in ${s}` : `overdue by ${s}`;
}

function formatDue(p) {
  if (!p.dueAt) return p.dueLabel;
  const when = new Date(p.dueAt).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return p.dueSource === 'default' ? `${when} (no date given, defaulted)` : when;
}

const PromiseRow = ({ p, mode, onChanged, onDraft }) => {
  const [busy, setBusy] = useState(false);
  const act = async (op, extra = {}) => {
    setBusy(true);
    const res = await invoke('updatePromise', { id: p.id, op, ...extra });
    setBusy(false);
    if (res?.promise) onChanged(res.promise);
  };
  const st = STATUS[p.status] || STATUS.open;
  const active = ACTIVE.includes(p.status);

  return (
    <Box xcss={{ paddingBlock: 'space.150', borderBottomWidth: 'border.width', borderBottomStyle: 'solid', borderBottomColor: 'color.border' }}>
      <Stack space="space.100">
        <Inline space="space.100" alignBlock="center" shouldWrap>
          <Lozenge appearance={st.appearance} isBold={p.status === 'at_risk' || p.status === 'broken'}>{st.label}</Lozenge>
          <Lozenge>{KIND[p.kind] || p.kind}</Lozenge>
          {active && p.dueAt ? <Text size="small" color="color.text.subtle">{relative(p.dueAt)}</Text> : null}
          {mode === 'dev' ? <Link href={`/browse/${p.issueKey}`}>{p.issueKey}</Link> : null}
        </Inline>

        <Text>
          “{p.quote}”
        </Text>

        {(p.status === 'at_risk' || p.status === 'ready' || p.status === 'broken') && p.reason ? (
          <SectionMessage appearance={p.status === 'ready' ? 'success' : p.status === 'broken' ? 'error' : 'warning'}>
            <Text>{p.reason}</Text>
          </SectionMessage>
        ) : null}

        <Text size="small" color="color.text.subtle">
          Due <Strong>{formatDue(p)}</Strong> · Owner {p.ownerName}
          {mode === 'dev' && p.customerName ? ` · Customer ${p.customerName}` : ''}
          {mode !== 'dev' && p.devIssueKey ? ' · Depends on ' : ''}
        </Text>
        {mode !== 'dev' && p.devIssueKey ? <Link href={`/browse/${p.devIssueKey}`}>{p.devIssueKey}</Link> : null}
        {!active ? <Text size="small" color="color.text.subtle"><Em>{p.reason}</Em></Text> : null}

        {mode !== 'dev' ? (
          <ButtonGroup>
            {active && (p.status === 'ready' || p.status === 'at_risk') ? (
              <Button appearance="primary" isDisabled={busy} onClick={() => onDraft(p)}>Tell customer</Button>
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
  const atRisk = promises.filter((p) => p.status === 'at_risk').length;
  const ready = promises.filter((p) => p.status === 'ready').length;
  const open = promises.filter((p) => ACTIVE.includes(p.status));
  const customers = new Set(promises.map((p) => p.issueKey)).size;

  const onChanged = (updated) => setData({ ...data, promises: promises.map((p) => (p.id === updated.id ? updated : p)) });

  return (
    <Stack space="space.100">
      {data.mode === 'dev' ? (
        <SectionMessage appearance={atRisk ? 'warning' : 'information'} title={`${open.length} customer promise${open.length === 1 ? ' depends' : 's depend'} on this issue`}>
          <Text>
            Promised on {customers} support request{customers === 1 ? '' : 's'}. Moving this issue out of its sprint or release puts them at risk, and resolving it lets the agents close the loop.
          </Text>
        </SectionMessage>
      ) : atRisk || ready ? (
        <SectionMessage appearance={atRisk ? 'warning' : 'success'}>
          <Text>
            {atRisk ? `${atRisk} promise${atRisk > 1 ? 's' : ''} at risk. ` : ''}
            {ready ? `${ready} fix${ready > 1 ? 'es are' : ' is'} live: tell the customer.` : ''}
          </Text>
        </SectionMessage>
      ) : null}

      {promises.map((p) => (
        <PromiseRow key={p.id} p={p} mode={data.mode} onChanged={onChanged} onDraft={setDrafting} />
      ))}

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
