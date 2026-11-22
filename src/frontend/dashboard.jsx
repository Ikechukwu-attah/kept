/**
 * Kept dashboard (Jira global page): what needs attention across all
 * support requests the viewer can see, plus kept rate per agent.
 */
import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Box, DynamicTable, EmptyState, Heading, Inline, Link, Lozenge, Spinner, Stack, Text, Strong } from '@forge/react';
import { invoke } from '@forge/bridge';

const STATUS = {
  open: ['Open', 'inprogress'],
  at_risk: ['At risk', 'moved'],
  ready: ['Ready to close the loop', 'new'],
  kept: ['Kept', 'success'],
  broken: ['Broken', 'removed'],
};

const Tile = ({ label, value, hint }) => (
  <Box xcss={{ padding: 'space.200', borderWidth: 'border.width', borderStyle: 'solid', borderColor: 'color.border', borderRadius: 'border.radius.200', minWidth: '180px' }}>
    <Stack space="space.050">
      <Text size="small" color="color.text.subtle">{label}</Text>
      <Heading as="h2">{value}</Heading>
      {hint ? <Text size="small" color="color.text.subtle">{hint}</Text> : null}
    </Stack>
  </Box>
);

const due = (p) => (p.dueAt ? new Date(p.dueAt).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : p.dueLabel);

const App = () => {
  const [data, setData] = useState(null);
  useEffect(() => {
    invoke('getDashboard').then(setData);
  }, []);
  if (!data) return <Spinner label="Loading promises" />;

  const s = data.stats;
  const rows = data.attention.map((p) => ({
    key: p.id,
    cells: [
      { key: 'status', content: <Lozenge appearance={STATUS[p.status]?.[1]}>{STATUS[p.status]?.[0] || p.status}</Lozenge> },
      { key: 'request', content: <Link href={`/browse/${p.issueKey}`}>{p.issueKey}</Link> },
      { key: 'customer', content: p.customerName || '—' },
      { key: 'promise', content: `“${p.quote}”` },
      { key: 'due', content: due(p) },
      { key: 'owner', content: p.ownerName },
      { key: 'why', content: p.reason },
    ],
  }));

  return (
    <Stack space="space.300">
      <Stack space="space.050">
        <Heading as="h1">Promises</Heading>
        <Text color="color.text.subtle">Every commitment your agents made to customers in the last 60 days, found in their public replies.</Text>
      </Stack>

      <Inline space="space.200" shouldWrap>
        <Tile label="Due in the next 24 hours" value={String(s.dueSoon)} />
        <Tile label="At risk" value={String(s.atRisk)} hint="Dev work they depend on slipped" />
        <Tile label="Ready to close the loop" value={String(s.ready)} hint="Fix is live, customer not told" />
        <Tile label="Broken (30 days)" value={String(s.broken)} />
        <Tile label="Kept rate (30 days)" value={s.keptRate == null ? '—' : `${s.keptRate}%`} hint={`${s.decided} promises decided`} />
      </Inline>

      <Stack space="space.100">
        <Heading as="h3">Needs attention</Heading>
        {rows.length ? (
          <DynamicTable
            head={{ cells: ['Status', 'Request', 'Customer', 'Promise', 'Due', 'Owner', 'Why'].map((c) => ({ key: c, content: c })) }}
            rows={rows}
            rowsPerPage={15}
          />
        ) : (
          <EmptyState header="Nothing needs attention" description="No open, at-risk or broken promises right now." />
        )}
      </Stack>

      <Stack space="space.100">
        <Heading as="h3">By agent</Heading>
        <DynamicTable
          head={{ cells: ['Agent', 'Open', 'At risk', 'Kept', 'Broken', 'Kept rate'].map((c) => ({ key: c, content: c })) }}
          rows={data.owners.map((o) => ({
            key: o.owner,
            cells: [
              { key: 'a', content: <Strong>{o.owner}</Strong> },
              { key: 'b', content: String(o.active) },
              { key: 'c', content: String(o.atRisk) },
              { key: 'd', content: String(o.kept) },
              { key: 'e', content: String(o.broken) },
              { key: 'f', content: o.kept + o.broken ? `${Math.round((o.kept / (o.kept + o.broken)) * 100)}%` : '—' },
            ],
          }))}
        />
      </Stack>
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
