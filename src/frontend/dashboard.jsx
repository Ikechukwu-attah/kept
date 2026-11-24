/**
 * Kept dashboard (Jira global page): what needs attention across every support
 * request the viewer can see, trends, and kept rate per agent.
 */
import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Box, DonutChart, DynamicTable, EmptyState, Heading, Icon, Inline, Link, Lozenge, ProgressBar, Spinner, Stack,
  StackBarChart, Strong, Text, xcss,
} from '@forge/react';
import { invoke } from '@forge/bridge';

const STATUS = {
  open: ['Open', 'inprogress'],
  at_risk: ['At risk', 'moved'],
  ready: ['Ready to close the loop', 'new'],
  kept: ['Kept', 'success'],
  broken: ['Broken', 'removed'],
};

const tile = (bg) =>
  xcss({
    padding: 'space.200',
    borderRadius: 'border.radius.200',
    backgroundColor: bg,
    minWidth: '200px',
    flexGrow: 1,
  });
const panel = xcss({
  padding: 'space.200',
  borderWidth: 'border.width',
  borderStyle: 'solid',
  borderColor: 'color.border',
  borderRadius: 'border.radius.200',
  flexGrow: 1,
  minWidth: '360px',
});

const Tile = ({ icon, label, value, hint, bg }) => (
  <Box xcss={tile(bg)}>
    <Stack space="space.050">
      <Inline space="space.075" alignBlock="center">
        <Icon glyph={icon} label="" size="small" />
        <Text size="small" weight="medium">{label}</Text>
      </Inline>
      <Heading as="h2">{value}</Heading>
      {hint ? <Text size="small" color="color.text.subtle">{hint}</Text> : null}
    </Stack>
  </Box>
);

/** "in 2 days" / "3 days overdue" */
function relative(ms, now) {
  if (!ms) return '';
  const diff = ms - now;
  const days = Math.round(Math.abs(diff) / 86400000);
  const hours = Math.round(Math.abs(diff) / 3600000);
  const span = days >= 1 ? `${days} day${days > 1 ? 's' : ''}` : `${Math.max(hours, 1)} hour${hours > 1 ? 's' : ''}`;
  return diff >= 0 ? `in ${span}` : `${span} overdue`;
}
const when = (p) =>
  p.dueAt ? new Date(p.dueAt).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : p.dueLabel;

const App = () => {
  const [data, setData] = useState(null);
  useEffect(() => {
    invoke('getDashboard').then(setData);
  }, []);
  if (!data) return <Spinner label="Loading promises" />;

  const s = data.stats;
  const t = data.trends || { weekly: [], mix: [], kinds: [] };
  const hasHistory = t.weekly.some((r) => r.count > 0);

  const rows = data.attention.map((p) => {
    const late = p.dueAt && p.dueAt < data.now;
    return {
      key: p.id,
      cells: [
        { key: 'status', content: <Lozenge appearance={STATUS[p.status]?.[1]} isBold={p.status === 'broken' || p.status === 'at_risk'}>{STATUS[p.status]?.[0] || p.status}</Lozenge> },
        { key: 'request', content: <Link href={`/browse/${p.issueKey}`}>{p.issueKey}</Link> },
        { key: 'customer', content: p.customerName || '—' },
        { key: 'promise', content: <Text>“{p.quote}”</Text> },
        {
          key: 'due',
          content: (
            <Stack space="space.0">
              <Text size="small" weight="medium" color={late ? 'color.text.danger' : 'color.text'}>{relative(p.dueAt, data.now) || p.dueLabel}</Text>
              <Text size="small" color="color.text.subtle">{when(p)}</Text>
            </Stack>
          ),
        },
        { key: 'owner', content: p.ownerName },
        { key: 'why', content: <Text size="small">{p.reason}</Text> },
      ],
    };
  });

  return (
    <Stack space="space.300">
      <Text color="color.text.subtle">Every commitment your agents made to customers in the last 60 days, read from their public replies.</Text>

      <Inline space="space.200" shouldWrap>
        <Tile icon="clock" label="Due in the next 24 hours" value={String(s.dueSoon)} hint="Reminders go to the owner" bg="color.background.accent.blue.subtlest" />
        <Tile icon="warning" label="At risk" value={String(s.atRisk)} hint="Dev work they depend on slipped" bg="color.background.accent.orange.subtlest" />
        <Tile icon="check-circle" label="Ready to close the loop" value={String(s.ready)} hint="Fix is live, customer not told" bg="color.background.accent.purple.subtlest" />
        <Tile icon="error" label="Broken (30 days)" value={String(s.broken)} hint="Deadline passed, no reply" bg="color.background.accent.red.subtlest" />
        <Box xcss={tile('color.background.accent.green.subtlest')}>
          <Stack space="space.050">
            <Inline space="space.075" alignBlock="center">
              <Icon glyph="success" label="" size="small" />
              <Text size="small" weight="medium">Kept rate (30 days)</Text>
            </Inline>
            <Heading as="h2">{s.keptRate == null ? '—' : `${s.keptRate}%`}</Heading>
            {s.keptRate == null ? null : <ProgressBar value={s.keptRate / 100} appearance="success" ariaLabel="Kept rate" />}
            <Text size="small" color="color.text.subtle">{s.decided} promises decided</Text>
          </Stack>
        </Box>
      </Inline>

      <Inline space="space.200" shouldWrap alignBlock="stretch">
        <Box xcss={panel}>
          {hasHistory ? (
            <StackBarChart data={t.weekly} xAccessor="week" yAccessor="count" colorAccessor="status" colorPalette={[{ key: 'Kept', value: '#22A06B' }, { key: 'Broken', value: '#C9372C' }]} title="Kept vs broken, by week" subtitle="Promises decided in each of the last 6 weeks" height={260} hideMenu />
          ) : (
            <EmptyState header="No decided promises yet" description="Kept and broken promises will chart here week by week." />
          )}
        </Box>
        <Box xcss={panel}>
          {t.mix.length ? (
            <DonutChart data={t.mix} colorAccessor="status" valueAccessor="count" labelAccessor="status" colorPalette={[{ key: 'Open', value: '#1D7AFC' }, { key: 'At risk', value: '#E2A300' }, { key: 'Ready to close the loop', value: '#8270DB' }]} title="Open promises right now" subtitle="By status" height={260} hideMenu />
          ) : (
            <EmptyState header="Nothing open" description="Every promise is kept or closed." />
          )}
        </Box>
      </Inline>

      <Stack space="space.100">
        <Inline space="space.100" alignBlock="center">
          <Icon glyph="flag-filled" label="" size="small" />
          <Heading as="h3">Needs attention</Heading>
        </Inline>
        {rows.length ? (
          <DynamicTable
            head={{ cells: ['Status', 'Request', 'Customer', 'Promise', 'Due', 'Owner', 'Why'].map((c) => ({ key: c, content: c })) }}
            rows={rows}
            rowsPerPage={10}
          />
        ) : (
          <EmptyState header="Nothing needs attention" description="No open, at-risk or broken promises right now." />
        )}
      </Stack>

      <Stack space="space.100">
        <Inline space="space.100" alignBlock="center">
          <Icon glyph="person" label="" size="small" />
          <Heading as="h3">By agent</Heading>
        </Inline>
        <DynamicTable
          head={{ cells: ['Agent', 'Open', 'At risk', 'Kept', 'Broken', 'Kept rate'].map((c) => ({ key: c, content: c })) }}
          rows={data.owners.map((o) => {
            const rate = o.kept + o.broken ? Math.round((o.kept / (o.kept + o.broken)) * 100) : null;
            return {
              key: o.owner,
              cells: [
                { key: 'a', content: <Strong>{o.owner}</Strong> },
                { key: 'b', content: String(o.active) },
                { key: 'c', content: String(o.atRisk) },
                { key: 'd', content: String(o.kept) },
                { key: 'e', content: String(o.broken) },
                {
                  key: 'f',
                  content:
                    rate == null ? '—' : (
                      <Inline space="space.100" alignBlock="center">
                        <Box xcss={xcss({ width: '120px' })}><ProgressBar value={rate / 100} appearance={rate >= 80 ? 'success' : 'default'} ariaLabel="Kept rate" /></Box>
                        <Text>{rate}%</Text>
                      </Inline>
                    ),
                },
              ],
            };
          })}
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
