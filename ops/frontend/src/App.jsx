import { useCallback, useEffect, useRef, useState } from 'react'
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { clamp, fmt, json, login, num, request, session, setOnExpire } from './api'
import { Cases, Deliveries, Records } from './Workflow'

const TABS = [
  ['Overview', 'report:read'], ['Field entry', 'fruit:write'], ['Field records', 'fruit:read'], ['Factory entry', 'factory:write'],
  ['Deliveries', 'delivery:read'], ['Cases', 'reconcile:read'], ['Daily reconciliation', 'report:read'], ['Import workbook', 'import:write']]

function Login({ onDone, note }) {
  const [f, setF] = useState({ email: '', password: '' })
  const [err, setErr] = useState(note || null)
  const [busy, setBusy] = useState(false)
  const submit = async e => {
    e.preventDefault(); setBusy(true); setErr(null)
    try { onDone(await login(f.email, f.password)) } catch (x) { setErr(x.message) } finally { setBusy(false) }
  }
  return (
    <main style={{ maxWidth: 420, margin: '10vh auto' }}>
      <h2>SCIPEC operations</h2>
      <form className="panel" onSubmit={submit}>
        {err && <div className="notice error" role="alert">{err}</div>}
        <label>Email<input type="email" required autoComplete="username" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></label>
        <label style={{ marginTop: 12 }}>Password<input type="password" required autoComplete="current-password" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} /></label>
        <p><button className="btn" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button></p>
      </form></main>)
}

export default function App() {
  const [user, setUser] = useState(() => session.get()?.user || null)
  const [note, setNote] = useState(null)
  useEffect(() => { setOnExpire(() => { setUser(null); setNote('Your session expired. Sign in again.') }) }, [])
  const signOut = () => { session.clear(); setUser(null); setNote(null) }
  if (!user) return <Login onDone={u => { setNote(null); setUser(u) }} note={note} />
  return <Workspace user={user} signOut={signOut} />
}

function Workspace({ user, signOut }) {
  const can = p => user.permissions.includes('*') || user.permissions.includes(p)
  const tabs = TABS.filter(([, p]) => can(p)).map(([t]) => t)
  const [cfg, setCfg] = useState(null)
  const [tab, setTab] = useState(tabs[0])
  const [range, setRange] = useState({ start: '', end: '' })
  const [data, setData] = useState({ summary: null, series: [], recon: [] })
  const [notice, setNotice] = useState(null)
  const [loading, setLoading] = useState(false)
  const say = (kind, text) => setNotice({ kind, text })

  useEffect(() => {
    request('/api/v1/config').then(c => { setCfg(c); setRange({ start: c.cycle_start, end: c.cycle_end }) }).catch(e => say('error', e.message))
  }, [])

  const load = useCallback(async () => {
    if (!range.start || !range.end || !can('report:read')) return
    setLoading(true)
    const q = `?start=${range.start}&end=${range.end}`
    try {
      const [summary, series, recon] = await Promise.all([
        request(`/api/v1/dashboard/summary${q}`), request(`/api/v1/dashboard/timeseries${q}&freq=D`), request(`/api/v1/reports/reconciliation${q}`)])
      setData({ summary, series, recon })
    } catch (e) { say('error', e.message) } finally { setLoading(false) }
  }, [range])
  useEffect(() => { load() }, [load])

  if (!cfg) return <main>{notice ? <div className="notice error">{notice.text}</div> : 'Loading…'}</main>
  return (
    <div className="shell">
      <nav aria-label="Sections">
        <h1>SCIPEC operations</h1>
        {tabs.map(t => <button key={t} aria-current={t === tab} onClick={() => { setTab(t); setNotice(null) }}>{t}</button>)}
        <div style={{ marginTop: 'auto', fontSize: 13 }}>{user.email}<br />{user.role.replace(/_/g, ' ')}<br /><button onClick={signOut}>Sign out</button></div>
      </nav>
      <main>
        {notice && <div className={`notice ${notice.kind}`} role="status">{notice.text}</div>}
        {['Overview', 'Daily reconciliation'].includes(tab) && (
          <div className="range">
            <label>From<input type="date" value={range.start} min={cfg.cycle_start} max={range.end} onChange={e => setRange(r => ({ ...r, start: e.target.value }))} /></label>
            <label>To<input type="date" value={range.end} min={range.start} max={cfg.cycle_end} onChange={e => setRange(r => ({ ...r, end: e.target.value }))} /></label>
            <button className="btn alt" onClick={load} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
            {data.summary && <span className="hint">Updated {new Date(data.summary.generated_at).toLocaleTimeString()} · drafts are excluded</span>}
          </div>)}
        {tab === 'Overview' && <Overview {...data} />}
        {tab === 'Field entry' && <FieldEntry cfg={cfg} say={say} reload={load} />}
        {tab === 'Field records' && <Records cfg={cfg} user={user} can={can} say={say} />}
        {tab === 'Factory entry' && <FactoryEntry cfg={cfg} say={say} reload={load} />}
        {tab === 'Deliveries' && <Deliveries cfg={cfg} can={can} say={say} />}
        {tab === 'Cases' && <Cases can={can} say={say} />}
        {tab === 'Daily reconciliation' && <Recon rows={data.recon} cfg={cfg} />}
        {tab === 'Import workbook' && <Importer say={say} reload={load} />}
      </main>
    </div>)
}

function Overview({ summary: s, series }) {
  if (!s) return null
  const rows = [
    ['FFB harvested', s.harvested, 't', 'All three blocks'], ['FFB collected', s.collected, 't', 'Gathered at collection points'],
    ['FFB transported', s.transported, 't', 'Dispatched to the factory'], ['Left in field', s.left_in_field, 't', 'Derived: harvested − collected'],
    ['FFB received at factory', s.received, 't', 'Factory gate'], ['FFB processed', s.processed, 't', 'Fed to the mill'],
    ['Palm oil produced', s.oil, 't', 'Crude palm oil'], ['Oil extraction rate', s.yield_pct, '%', 'Oil ÷ FFB processed'], ['Factory downtime', s.downtime, 'h', 'Reported stoppage']]
  return (<>
    <h2>Overview</h2>
    {(s.missing_days > 0 || s.flagged_days > 0 || s.oer_alerts > 0 || s.open_cases > 0) && (
      <div className="notice warn">{s.flagged_days} day(s) outside the {'\u00B1'}variance limit · {s.missing_days} day(s) with missing records · {s.oer_alerts} extraction-rate alert(s) · {s.open_cases} open delivery case(s)</div>)}
    <div className="panel scroll"><table className="ledger"><tbody>
      {rows.map(([k, v, u, n]) => <tr key={k}><td>{k}</td><td className="big">{fmt(v)}</td><td>{u}</td><td>{n}</td></tr>)}
    </tbody></table></div>
    <div className="panel"><div style={{ height: 300 }}>
      <ResponsiveContainer><LineChart data={series}>
        <CartesianGrid stroke="#dfe6e1" /><XAxis dataKey="date" tickFormatter={d => d.slice(8)} /><YAxis /><Tooltip /><Legend />
        <Line dataKey="collected" name="Collected" stroke="#24493a" dot={false} connectNulls />
        <Line dataKey="transported" name="Transported" stroke="#e3a21a" dot={false} connectNulls />
        <Line dataKey="received" name="Received" stroke="#a8321f" dot={false} connectNulls />
      </LineChart></ResponsiveContainer></div></div>
  </>)
}

function Recon({ rows, cfg }) {
  const exportCsv = () => {
    const head = ['date', 'harvested', 'collected', 'transported', 'received', 'difference', 'window_diff', 'yield_pct', 'status']
    const csv = [head, ...rows.map(r => head.map(h => r[h] ?? ''))].map(r => r.join(',')).join('\n')
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: 'reconciliation.csv' })
    a.click(); URL.revokeObjectURL(a.href)
  }
  return (<>
    <h2>Reconciliation</h2>
    <p className="hint">Dispatched and received tonnage are compared over a two-day window so overnight deliveries don't raise false alarms. Limit: {cfg.variance_tonnes} t.</p>
    <div className="legend">
      <span><i className="s-ok" />Within limit</span><span><i className="s-flag" />Over limit</span><span><i className="s-missing" />Records missing</span></div>
    <div className="strip">{rows.map(r => <div key={r.date} className={`s-${r.status}`} title={`${r.date}: ${r.status}`}>{r.date.slice(8)}</div>)}</div>
    <div className="panel scroll"><table>
      <thead><tr><th>Date</th><th>Collected</th><th>Transported</th><th>Received</th><th>Difference</th><th>2-day diff</th><th>Yield %</th></tr></thead>
      <tbody>{rows.map(r => <tr key={r.date}><td>{r.date}</td><td>{fmt(r.collected)}</td><td>{fmt(r.transported)}</td><td>{fmt(r.received)}</td>
        <td>{fmt(r.difference)}</td><td className={r.status === 'flag' ? 'bad' : ''}>{fmt(r.window_diff)}</td><td className={r.oer_alert ? 'bad' : ''}>{fmt(r.yield_pct)}</td></tr>)}</tbody>
    </table></div>
    <button className="btn alt" onClick={exportCsv} disabled={!rows.length}>Export CSV</button>
  </>)
}

function useForm(initial) {
  const [v, setV] = useState(initial)
  return [v, k => e => setV(s => ({ ...s, [k]: e.target.value })), setV]
}

function FieldEntry({ cfg, say, reload }) {
  const today = new Date().toISOString().slice(0, 10)
  const blank = { date: clamp(today, cfg.cycle_start, cfg.cycle_end), block: cfg.blocks[0], harvested: '', collected: '', transported: '', harvesters: '', collectors: '', reason: '', remarks: '' }
  const [f, on, setF] = useForm(blank)
  const [saving, setSaving] = useState(false)
  const key = useRef(crypto.randomUUID())
  const left = f.harvested !== '' && f.collected !== '' ? Number(f.harvested) - Number(f.collected) : null
  const conflict = left < 0 ? 'Collected is more than harvested.' : f.transported !== '' && Number(f.transported) > Number(f.collected) ? 'Transported is more than collected.' : null
  const submit = async e => {
    e.preventDefault(); setSaving(true)
    try {
      await request('/api/v1/fruit-collection', json({ date: f.date, block: f.block, harvested: num(f.harvested), collected: num(f.collected), transported: num(f.transported), harvesters: num(f.harvesters), collectors: num(f.collectors), reason: f.reason || null, remarks: f.remarks || null }, key.current))
      key.current = crypto.randomUUID()
      say('ok', `Saved ${f.block}, ${f.date} as a draft. Submit it from Field records.`); setF({ ...blank, date: f.date, block: f.block }); reload()
    } catch (err) { say('error', err.message) } finally { setSaving(false) }
  }
  return (<>
    <h2>Field entry</h2>
    <form className="panel" onSubmit={submit}>
      <div className="grid">
        <label>Date<input type="date" required value={f.date} min={cfg.cycle_start} max={clamp(today, cfg.cycle_start, cfg.cycle_end)} onChange={on('date')} /></label>
        <label>Block<select value={f.block} onChange={on('block')}>{cfg.blocks.map(b => <option key={b}>{b}</option>)}</select></label>
        {[['harvested', 'FFB harvested (t)'], ['collected', 'FFB collected (t)'], ['transported', 'FFB transported (t)']].map(([k, l]) =>
          <label key={k}>{l}<input type="number" min="0" step="0.001" value={f[k]} onChange={on(k)} /></label>)}
        <label>Harvesters<input type="number" min="0" step="1" value={f.harvesters} onChange={on('harvesters')} /></label>
        <label>Collectors<input type="number" min="0" step="1" value={f.collectors} onChange={on('collectors')} /></label>
      </div>
      <p className="hint">Left in field: <strong>{left == null ? '–' : left.toFixed(3)} t</strong> (calculated)</p>
      {left > 0 && <label>Reason for shortfall (required)<input required value={f.reason} onChange={on('reason')} /></label>}
      <label style={{ marginTop: 12 }}>Supervisor remarks<textarea rows="2" value={f.remarks} onChange={on('remarks')} /></label>
      {conflict && <p className="bad">{conflict}</p>}
      <p><button className="btn" disabled={saving || !!conflict}>{saving ? 'Saving…' : 'Save field record'}</button></p>
    </form></>)
}

function FactoryEntry({ cfg, say, reload }) {
  const today = new Date().toISOString().slice(0, 10)
  const blank = { date: clamp(today, cfg.cycle_start, cfg.cycle_end), ffb_banakanuke: '', ffb_batchepo: '', ffb_bakilo: '', processed: '', oil: '', downtime: '', remarks: '' }
  const [f, on, setF] = useForm(blank)
  const [saving, setSaving] = useState(false)
  const labels = { ffb_banakanuke: 'From Banakanuke (t)', ffb_batchepo: 'From Batchepo (t)', ffb_bakilo: 'From Bakilo (t)', processed: 'FFB processed (t)', oil: 'Palm oil produced (t)', downtime: 'Downtime (hours, 0–24)' }
  const submit = async e => {
    e.preventDefault(); setSaving(true)
    try {
      const body = { date: f.date, remarks: f.remarks || null }
      Object.keys(labels).forEach(k => { body[k] = num(f[k]) })
      const r = await request('/api/v1/factory-production', json(body))
      say(r.warnings.length ? 'warn' : 'ok', r.warnings.length ? `Saved with ${r.warnings.length} warning(s): ${r.warnings.join(' | ')}` : `Saved factory record for ${f.date}.`)
      setF({ ...blank, date: f.date }); reload()
    } catch (err) { say('error', err.message) } finally { setSaving(false) }
  }
  return (<>
    <h2>Factory entry</h2>
    <form className="panel" onSubmit={submit}>
      <div className="grid">
        <label>Date<input type="date" required value={f.date} min={cfg.cycle_start} max={clamp(today, cfg.cycle_start, cfg.cycle_end)} onChange={on('date')} /></label>
        {Object.entries(labels).map(([k, l]) => <label key={k}>{l}<input type="number" min="0" max={k === 'downtime' ? 24 : undefined} step="0.001" value={f[k]} onChange={on(k)} /></label>)}
      </div>
      <label style={{ marginTop: 12 }}>Remarks<textarea rows="2" value={f.remarks} onChange={on('remarks')} /></label>
      <p><button className="btn" disabled={saving}>{saving ? 'Saving…' : 'Save factory record'}</button></p>
    </form></>)
}

function Importer({ say, reload }) {
  const [file, setFile] = useState(null)
  const [mode, setMode] = useState('merge')
  const [report, setReport] = useState(null)
  const [busy, setBusy] = useState(false)
  const run = async commit => {
    setBusy(true)
    const fd = new FormData(); fd.append('file', file)
    try {
      const r = await request(`/api/v1/import?mode=${mode}&commit=${commit}`, { method: 'POST', body: fd })
      setReport(r)
      if (commit) { say('ok', `Imported: ${r.inserts} new, ${r.updates} updated.`); reload() }
    } catch (e) { setReport(e.body?.error?.details?.errors ? e.body.error.details : null); say('error', e.message) } finally { setBusy(false) }
  }
  const ok = report && !report.errors.length && report.inserts + report.updates > 0 && !report.committed
  return (<>
    <h2>Import workbook</h2>
    <div className="panel">
      <div className="range">
        <label>Excel file<input type="file" accept=".xlsx" onChange={e => { setFile(e.target.files[0]); setReport(null) }} /></label>
        <label>Blank cells<select value={mode} onChange={e => { setMode(e.target.value); setReport(null) }}>
          <option value="merge">Keep existing values</option><option value="replace">Clear existing values</option></select></label>
        <button className="btn alt" disabled={!file || busy} onClick={() => run(false)}>Preview changes</button>
        <button className="btn" disabled={!ok || busy} onClick={() => run(true)}>Import now</button>
      </div>
      <p className="hint">Nothing is saved until you import. If any row is invalid, the whole import is rejected.</p>
      {report && <>
        <p><strong>{report.inserts}</strong> new · <strong>{report.updates}</strong> updated · <strong>{report.errors.length}</strong> invalid row(s)</p>
        {report.cleared_cells?.length > 0 && <div className="notice warn">Will clear values: {report.cleared_cells.map(c => `${c.sheet} row ${c.row} (${c.fields.join(', ')})`).join('; ')}</div>}
        {report.warnings?.map(w => <div key={w.row} className="notice warn">Factory row {w.row}: {w.messages.join('; ')}</div>)}
        {report.errors.map(e => <div key={`${e.sheet}${e.row}`} className="notice error">{e.sheet}, row {e.row}: {e.errors.join('; ')}</div>)}
      </>}
    </div></>)
}
