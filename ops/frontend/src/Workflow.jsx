import { useCallback, useEffect, useState } from 'react'
import { fmt, json, request } from './api'

function usePaged(path, params) {
  const [page, setPage] = useState(1)
  const [state, setState] = useState({ data: null, error: null, loading: true })
  const qs = new URLSearchParams({ ...params, page, page_size: 15 }).toString()
  const reload = useCallback(() => {
    setState(s => ({ ...s, loading: true }))
    request(`${path}?${qs}`).then(data => setState({ data, error: null, loading: false }))
      .catch(error => setState({ data: null, error: error.message, loading: false }))
  }, [path, qs])
  useEffect(reload, [reload])
  useEffect(() => setPage(1), [JSON.stringify(params)])
  return { ...state, page, setPage, reload }
}

function Pager({ s }) {
  const d = s.data
  if (!d) return null
  const pages = Math.max(1, Math.ceil(d.total / d.page_size))
  return (
    <p className="hint">{d.total} record(s) · page {d.page} of {pages}{' '}
      <button className="btn alt" disabled={d.page <= 1} onClick={() => s.setPage(d.page - 1)}>Previous</button>{' '}
      <button className="btn alt" disabled={d.page >= pages} onClick={() => s.setPage(d.page + 1)}>Next</button></p>)
}

const Status = ({ v }) => <span className={`tag t-${v}`}>{v.replace('_', ' ')}</span>

export function Records({ cfg, user, can, say }) {
  const [f, setF] = useState({ status: '', block: '', sort: '-date', start: cfg.cycle_start, end: cfg.cycle_end })
  const s = usePaged('/api/v1/fruit-collection', Object.fromEntries(Object.entries(f).filter(([, v]) => v)))
  const act = async (id, action) => {
    try { await request(`/api/v1/fruit-collection/${id}/${action}`, { method: 'POST' }); say('ok', `Record ${action === 'submit' ? 'submitted for approval' : 'approved'}.`); s.reload() }
    catch (e) { say('error', e.message) }
  }
  const on = k => e => setF(x => ({ ...x, [k]: e.target.value }))
  return (<>
    <h2>Field records</h2>
    <div className="range">
      <label>Status<select value={f.status} onChange={on('status')}><option value="">All</option><option>draft</option><option>submitted</option><option>approved</option></select></label>
      <label>Block<select value={f.block} onChange={on('block')}><option value="">All</option>{cfg.blocks.map(b => <option key={b}>{b}</option>)}</select></label>
      <label>Sort<select value={f.sort} onChange={on('sort')}><option value="-date">Newest first</option><option value="date">Oldest first</option><option value="-harvested">Most harvested</option></select></label>
    </div>
    {s.error && <div className="notice error">{s.error}</div>}
    <div className="panel scroll"><table>
      <thead><tr><th>Date</th><th>Block</th><th>Harvested</th><th>Collected</th><th>Transported</th><th>Left</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>
        {s.data?.items.map(r => <tr key={r.id}><td>{r.date}</td><td>{r.block}</td><td>{fmt(r.harvested)}</td><td>{fmt(r.collected)}</td><td>{fmt(r.transported)}</td><td>{fmt(r.left_in_field)}</td>
          <td><Status v={r.status} /></td>
          <td>{r.status === 'draft' && can('fruit:submit') && <button className="btn alt" onClick={() => act(r.id, 'submit')}>Submit</button>}
            {r.status === 'submitted' && can('fruit:approve') && r.created_by !== user.id && <button className="btn" onClick={() => act(r.id, 'approve')}>Approve</button>}
            {r.status === 'submitted' && can('fruit:approve') && r.created_by === user.id && <span className="hint">Needs a second approver</span>}</td></tr>)}
        {s.data && !s.data.items.length && <tr><td colSpan="8">No records match. Add one under Field entry.</td></tr>}
      </tbody></table></div>
    <Pager s={s} />
  </>)
}

export function Deliveries({ cfg, can, say }) {
  const s = usePaged('/api/v1/deliveries', {})
  const blank = { reference: '', block: cfg.blocks[0], vehicle: '', at: '', qty: '' }
  const [f, setF] = useState(blank)
  const [rcv, setRcv] = useState({})  // {id: {at, qty, ref}}
  const [key, setKey] = useState(() => crypto.randomUUID())
  const dispatch = async e => {
    e.preventDefault()
    try {
      await request('/api/v1/deliveries', json({ reference: f.reference, block: f.block, vehicle: f.vehicle || null, dispatched_at: new Date(f.at).toISOString(), dispatched_qty: Number(f.qty) }, key))
      say('ok', `Dispatch ${f.reference} recorded.`); setF(blank); setKey(crypto.randomUUID()); s.reload()
    } catch (err) { say('error', err.message) }
  }
  const receive = async d => {
    const r = rcv[d.id] || {}
    try {
      const out = await request(`/api/v1/deliveries/${d.id}/receipt`, json({ received_at: new Date(r.at).toISOString(), received_qty: Number(r.qty), weighbridge_ref: r.ref || null }, `rcv-${d.id}`))
      say(out.case_id ? 'warn' : 'ok', out.case_id ? `Received with a variance of ${fmt(out.variance)} t. A reconciliation case was opened.` : 'Receipt recorded. Quantities match.')
      s.reload()
    } catch (err) { say('error', err.message) }
  }
  const setR = (id, k) => e => setRcv(x => ({ ...x, [id]: { ...x[id], [k]: e.target.value } }))
  return (<>
    <h2>Deliveries</h2>
    {can('delivery:dispatch') && <form className="panel" onSubmit={dispatch}>
      <div className="grid">
        <label>Delivery reference<input required minLength="3" value={f.reference} onChange={e => setF({ ...f, reference: e.target.value })} /></label>
        <label>Block<select value={f.block} onChange={e => setF({ ...f, block: e.target.value })}>{cfg.blocks.map(b => <option key={b}>{b}</option>)}</select></label>
        <label>Vehicle<input value={f.vehicle} onChange={e => setF({ ...f, vehicle: e.target.value })} /></label>
        <label>Dispatched at<input type="datetime-local" required value={f.at} onChange={e => setF({ ...f, at: e.target.value })} /></label>
        <label>Dispatched (t)<input type="number" required min="0" step="0.001" value={f.qty} onChange={e => setF({ ...f, qty: e.target.value })} /></label>
      </div>
      <p><button className="btn">Record dispatch</button></p></form>}
    {s.error && <div className="notice error">{s.error}</div>}
    <div className="panel scroll"><table>
      <thead><tr><th>Reference</th><th>Block</th><th>Dispatched</th><th>Qty (t)</th><th>Status</th><th>Received (t)</th><th>Factory receipt</th></tr></thead>
      <tbody>{s.data?.items.map(d => <tr key={d.id}><td>{d.reference}</td><td>{d.block}</td><td>{new Date(d.dispatched_at).toLocaleString()}</td><td>{fmt(d.dispatched_qty)}</td>
        <td><Status v={d.status} /></td><td>{fmt(d.received_qty)}</td>
        <td>{d.status === 'in_transit' && can('delivery:receive') && <span style={{ display: 'inline-flex', gap: 6 }}>
          <input aria-label="Received at" type="datetime-local" onChange={setR(d.id, 'at')} /><input aria-label="Received tonnes" type="number" step="0.001" min="0" placeholder="t" style={{ width: 90 }} onChange={setR(d.id, 'qty')} />
          <input aria-label="Weighbridge reference" placeholder="Weighbridge ref" style={{ width: 120 }} onChange={setR(d.id, 'ref')} />
          <button className="btn" disabled={!rcv[d.id]?.at || rcv[d.id]?.qty === undefined || rcv[d.id]?.qty === ''} onClick={() => receive(d)}>Save receipt</button></span>}</td></tr>)}
        {s.data && !s.data.items.length && <tr><td colSpan="7">No deliveries yet.</td></tr>}</tbody></table></div>
    <Pager s={s} />
  </>)
}

export function Cases({ can, say }) {
  const [status, setStatus] = useState('open')
  const s = usePaged('/api/v1/reconciliation', status ? { status } : {})
  const [open, setOpen] = useState(null)
  const [reason, setReason] = useState('')
  const resolve = async c => {
    try { await request(`/api/v1/reconciliation/${c.id}/resolve`, json({ reason, version: c.version })); say('ok', 'Case resolved. The original quantities are kept.'); setOpen(null); setReason(''); s.reload() }
    catch (e) { say('error', e.message) }
  }
  return (<>
    <h2>Reconciliation cases</h2>
    <p className="hint">Each case is one delivery whose factory receipt differs from the dispatch by more than the limit. Variance = received − dispatched, so a negative value means fruit was lost in transit.</p>
    <div className="range"><label>Show<select value={status} onChange={e => setStatus(e.target.value)}><option value="open">Open</option><option value="resolved">Resolved</option><option value="">All</option></select></label></div>
    {s.error && <div className="notice error">{s.error}</div>}
    <div className="panel scroll"><table>
      <thead><tr><th>Delivery</th><th>Dispatched (t)</th><th>Received (t)</th><th>Variance (t)</th><th>Status</th><th>Resolution</th></tr></thead>
      <tbody>{s.data?.items.map(c => <tr key={c.id}><td>{c.delivery_reference}</td><td>{fmt(c.expected)}</td><td>{fmt(c.actual)}</td>
        <td className={c.variance < 0 ? 'bad' : ''}>{c.variance > 0 ? '+' : ''}{fmt(c.variance)} {c.variance < 0 ? '(short)' : '(over)'}</td><td><Status v={c.status} /></td>
        <td style={{ whiteSpace: 'normal', textAlign: 'left' }}>{c.status === 'resolved' ? c.resolution_reason
          : can('reconcile:resolve') && (open === c.id ? <span>
            <label>Explanation (required)<textarea rows="2" value={reason} onChange={e => setReason(e.target.value)} /></label>
            <button className="btn" disabled={reason.trim().length < 5} onClick={() => resolve(c)}>Resolve case</button>{' '}
            <button className="btn alt" onClick={() => setOpen(null)}>Cancel</button></span>
            : <button className="btn alt" onClick={() => { setOpen(c.id); setReason('') }}>Resolve…</button>)}</td></tr>)}
        {s.data && !s.data.items.length && <tr><td colSpan="6">No cases. Deliveries within the limit don't create one.</td></tr>}</tbody></table></div>
    <Pager s={s} />
  </>)
}
