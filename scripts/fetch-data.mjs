// Pulls Todoist tasks + two Google Calendar feeds and writes a static data.json
// for the GitHub Pages dashboard. Run by .github/workflows/update-data.yml on a
// schedule, or locally with the same env vars set.
//
// Required env:
//   TODOIST_API_TOKEN     - personal API token (Todoist Settings > Integrations > Developer)
//   GCAL_PRIMARY_ICS_URL  - the primary calendar's "Secret address in iCal format"
// Optional env:
//   GCAL_IE_ICS_URL       - a second calendar's secret iCal address (e.g. an imported
//                           class-schedule feed). Skipped entirely if not set.

import ical from 'node-ical';
import { writeFile, mkdir } from 'node:fs/promises';

const TODOIST_TOKEN = process.env.TODOIST_API_TOKEN;
const PRIMARY_ICS = process.env.GCAL_PRIMARY_ICS_URL;
const IE_ICS = process.env.GCAL_IE_ICS_URL || '';

if (!TODOIST_TOKEN) throw new Error('Missing env TODOIST_API_TOKEN');
if (!PRIMARY_ICS) throw new Error('Missing env GCAL_PRIMARY_ICS_URL');

const WINDOW_DAYS = 22;
const now = new Date();
const windowEnd = new Date(now.getTime() + WINDOW_DAYS * 86400000);

const PRIORITY_RANK = { p1: 1, p2: 2, p3: 3, p4: 4 };
const ONBOARDING_PROJECT_NAME_RE = /^getting started/i;
const ROUTINE_RE = /^(morning routine|night routine|breakfast|lunch|dinner|laundry)/i;
const LAST_UPDATE_RE = /^\*\*last update/i;

// --- Todoist -----------------------------------------------------------

async function todoist(path) {
  const res = await fetch(`https://api.todoist.com/rest/v2/${path}`, {
    headers: { Authorization: `Bearer ${TODOIST_TOKEN}` },
  });
  if (!res.ok) throw new Error(`Todoist ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

function apiPriorityToLabel(apiPriority) {
  // Todoist REST API: 4 = highest (shown as P1 in the app), 1 = normal (P4 in the app).
  return { 4: 'p1', 3: 'p2', 2: 'p3', 1: 'p4' }[apiPriority] || 'p4';
}

async function buildTaskData() {
  const [tasks, projects] = await Promise.all([todoist('tasks'), todoist('projects')]);
  const byId = Object.fromEntries(projects.map((p) => [p.id, p]));

  const taskRows = tasks
    .filter((t) => !ONBOARDING_PROJECT_NAME_RE.test(byId[t.project_id]?.name || ''))
    .map((t) => {
      const dueIso = t.due ? t.due.datetime || t.due.date : null;
      const due = dueIso ? new Date(dueIso) : null;
      const daysOverdue = due ? Math.floor((now - due) / 86400000) : null;
      return {
        id: t.id,
        content: t.content,
        priority: apiPriorityToLabel(t.priority),
        due: dueIso || '',
        projectName: byId[t.project_id]?.name || 'Other',
        daysOverdue,
        isOverdue: daysOverdue !== null && daysOverdue > 0,
        isStale: daysOverdue !== null && daysOverdue > 7,
      };
    })
    .sort((a, b) => (PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]) || ((b.daysOverdue || 0) - (a.daysOverdue || 0)));

  const priorityCounts = ['p1', 'p2', 'p3', 'p4'].map((p) => ({
    priority: p,
    label: p.toUpperCase(),
    count: taskRows.filter((r) => r.priority === p).length,
  }));

  return { taskRows, priorityCounts };
}

// --- Google Calendar (via secret iCal feeds) ----------------------------

async function loadEvents(url) {
  if (!url) return [];
  const parsed = await ical.async.fromURL(url);
  const out = [];
  for (const item of Object.values(parsed)) {
    if (item.type !== 'VEVENT') continue;
    const summary = item.summary || '';
    const location = item.location || '';
    if (item.rrule) {
      const occurrences = item.rrule.between(now, windowEnd, true);
      const duration = (item.end?.getTime?.() || item.start.getTime()) - item.start.getTime();
      for (const start of occurrences) {
        out.push({ summary, location, start, end: new Date(start.getTime() + duration) });
      }
    } else if (item.start && item.start >= now && item.start <= windowEnd) {
      out.push({ summary, location, start: item.start, end: item.end || item.start });
    }
  }
  return out;
}

function toScheduleRow(e, src) {
  const isDeadline = /due date/i.test(e.summary);
  const isClass = /\(ses\.?\s*\d/i.test(e.summary);
  const allDay = e.start.getHours() === 0 && e.start.getMinutes() === 0 && e.end - e.start >= 86400000;
  return {
    id: `${src}:${e.summary}:${e.start.toISOString()}`,
    date: e.start.toISOString().slice(0, 10),
    time: allDay ? 'All day' : e.start.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' }),
    title: e.summary.replace(/\s+/g, ' ').trim(),
    location: e.location || '',
    type: isDeadline ? 'deadline' : isClass ? 'class' : 'event',
    sortKey: e.start.getTime(),
    start: e.start.toISOString(),
    end: (e.end || e.start).toISOString(),
  };
}

async function buildCalendarData() {
  const [primary, ieFeed] = await Promise.all([loadEvents(PRIMARY_ICS), loadEvents(IE_ICS)]);

  const scheduleFeed = [
    ...primary.filter((e) => !ROUTINE_RE.test(e.summary)).map((e) => toScheduleRow(e, 'primary')),
    ...ieFeed.filter((e) => !LAST_UPDATE_RE.test(e.summary)).map((e) => toScheduleRow(e, 'ie')),
  ].sort((a, b) => a.sortKey - b.sortKey);

  const realDeadlines = ieFeed
    .filter((e) => /due date/i.test(e.summary))
    .map((e) => {
      const parts = e.summary.split('|');
      return {
        title: (parts[0] || '').replace(/\s+/g, ' ').trim(),
        detail: (parts[1] || '').replace(/\s+/g, ' ').trim(),
        due: e.start.toISOString(),
        daysLeft: Math.ceil((e.start - now) / 86400000),
      };
    })
    .sort((a, b) => new Date(a.due) - new Date(b.due));

  return { scheduleFeed, realDeadlines, ieFeedConfigured: Boolean(IE_ICS) };
}

// --- Main ----------------------------------------------------------------

const [{ taskRows, priorityCounts }, { scheduleFeed, realDeadlines, ieFeedConfigured }] = await Promise.all([
  buildTaskData(),
  buildCalendarData(),
]);

const data = {
  generatedAt: now.toISOString(),
  windowDays: WINDOW_DAYS,
  ieFeedConfigured,
  taskRows,
  priorityCounts,
  scheduleFeed,
  realDeadlines,
};

await mkdir('site/data', { recursive: true });
await writeFile('site/data/data.json', JSON.stringify(data, null, 2));
console.log(`Wrote site/data/data.json: ${taskRows.length} tasks, ${scheduleFeed.length} schedule rows, ${realDeadlines.length} deadlines.`);
