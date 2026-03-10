import { useEffect, useState, useRef, useCallback } from "react";

const MAX_FEED    = 80;
const MAX_VISIBLE = 25;
const WS_URL      = "wss://signal-qt35.onrender.com/ws";
const API_URL     = "https://signal-qt35.onrender.com";

// How long a card stays "fresh" / glowing
const FRESH_MS = 4000;
// How fast new cards get released from the queue (ms between releases)
const RELEASE_INTERVAL = 1800;

const TYPE_META = {
  whale:        { icon: "◈", label: "WHALE",     color: "#ff3b5c", bg: "rgba(255,59,92,0.06)",  glow: "#ff3b5c", accent: "#ff3b5c" },
  volume_spike: { icon: "▲", label: "VOL SPIKE", color: "#f7c948", bg: "rgba(247,201,72,0.05)", glow: "#f7c948", accent: "#f7c948" },
  new_token:    { icon: "✦", label: "NEW TOKEN", color: "#00e5ff", bg: "rgba(0,229,255,0.04)",  glow: "#00e5ff", accent: "#00e5ff" },
};

const fmt = (n) => {
  if (!n) return "$0";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(1)}K`;
  return `$${Number(n).toFixed(2)}`;
};
const relTime = (ts) => {
  const d = Math.floor((Date.now() - ts) / 1000);
  if (d < 5)  return "just now";
  if (d < 60) return `${d}s ago`;
  return `${Math.floor(d / 60)}m ago`;
};
const fmtAge = (ts) => {
  const d = Math.floor((Date.now() / 1000) - ts);
  if (d < 60)   return `${d}s old`;
  if (d < 3600) return `${Math.floor(d / 60)}m old`;
  return `${Math.floor(d / 3600)}h old`;
};

// ─── SPARKLINE ───────────────────────────────────────────────────────────────
function Sparkline({ prices, color, width = 340, height = 90 }) {
  if (!prices || prices.length < 2) {
    return (
      <div style={{ width, height, display: "flex", alignItems: "center", justifyContent: "center", color: "#1e1e1e", fontSize: 11, fontFamily: "monospace", letterSpacing: 3 }}>
        AWAITING DATA
      </div>
    );
  }
  const values = prices.map(p => p.usd);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pad = 8;
  const W = width - pad * 2;
  const H = height - pad * 2;
  const points = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * W;
    const y = pad + H - ((v - min) / range) * H;
    return `${x},${y}`;
  });
  const polyline = points.join(" ");
  const firstPt = points[0].split(",");
  const lastPt  = points[points.length - 1].split(",");
  const fillD = `M ${firstPt[0]} ${height} ${points.map(p => `L ${p.replace(",", " ")}`).join(" ")} L ${lastPt[0]} ${height} Z`;
  const isUp = values[values.length - 1] >= values[0];
  const lineColor = isUp ? "#14F195" : "#ff3b5c";
  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      <defs>
        <linearGradient id={`sg_${width}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={lineColor} stopOpacity="0.3" />
          <stop offset="100%" stopColor={lineColor} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={fillD} fill={`url(#sg_${width})`} />
      <polyline points={polyline} fill="none" stroke={lineColor} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lastPt[0]} cy={lastPt[1]} r="3" fill={lineColor} style={{ filter: `drop-shadow(0 0 5px ${lineColor})` }} />
    </svg>
  );
}

// ─── SCAN LINE OVERLAY ───────────────────────────────────────────────────────
function ScanLines() {
  return (
    <div style={{
      position: "fixed", inset: 0, pointerEvents: "none", zIndex: 9999,
      background: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.03) 2px, rgba(0,0,0,0.03) 4px)",
    }} />
  );
}

// ─── NOISE OVERLAY ───────────────────────────────────────────────────────────
function NoiseOverlay() {
  return (
    <div style={{
      position: "fixed", inset: 0, pointerEvents: "none", zIndex: 9998, opacity: 0.025,
      backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
    }} />
  );
}

// ─── DRAWER ──────────────────────────────────────────────────────────────────
function TokenDrawer({ token, onClose }) {
  const [data, setData]   = useState(null);
  const [loading, setLoad] = useState(true);
  const [error, setError]  = useState(null);

  useEffect(() => {
    if (!token) return;
    setLoad(true); setError(null);
    fetch(`${API_URL}/token/${token}`)
      .then(r => { if (!r.ok) throw new Error("Token not found"); return r.json(); })
      .then(d => { setData(d); setLoad(false); })
      .catch(e => { setError(e.message); setLoad(false); });
  }, [token]);

  const meta = TYPE_META[data?.type] || TYPE_META.new_token;

  return (
    <>
      <div onClick={onClose} style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 99,
        backdropFilter: "blur(4px)", animation: "fadeIn 0.2s ease",
      }} />
      <div style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width: 440,
        background: "#070707",
        borderLeft: "1px solid #161616",
        zIndex: 100,
        display: "flex", flexDirection: "column",
        animation: "drawerIn 0.3s cubic-bezier(0.16,1,0.3,1)",
        fontFamily: "'Space Mono', monospace",
      }}>
        {/* top accent line */}
        <div style={{ height: 2, background: `linear-gradient(90deg, ${meta.color}, transparent)` }} />

        {/* header */}
        <div style={{ padding: "22px 26px 18px", borderBottom: "1px solid #0f0f0f", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 8, color: "#2a2a2a", letterSpacing: 4, marginBottom: 8, fontFamily: "monospace" }}>TOKEN INTELLIGENCE</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#fff", letterSpacing: -0.5 }}>{token}</div>
          </div>
          <button onClick={onClose} style={{
            background: "#0e0e0e", border: "1px solid #1a1a1a", color: "#444",
            width: 34, height: 34, borderRadius: 6, cursor: "pointer", fontSize: 15,
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: "all 0.15s",
          }}>✕</button>
        </div>

        {/* body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "22px 26px" }}>
          {loading && (
            <div style={{ color: "#1e1e1e", textAlign: "center", paddingTop: 80, letterSpacing: 4, fontSize: 11, fontFamily: "monospace" }}>
              <div style={{ animation: "pulse 1.5s ease infinite" }}>LOADING SIGNAL DATA</div>
            </div>
          )}
          {error && <div style={{ color: "#ff3b5c", textAlign: "center", paddingTop: 80, fontSize: 12 }}>{error}</div>}
          {data && !loading && (
            <>
              <div style={{ marginBottom: 20 }}>
                <span style={{
                  fontSize: 9, fontWeight: 700, letterSpacing: 3, color: meta.color,
                  background: `${meta.color}12`, border: `1px solid ${meta.color}33`,
                  borderRadius: 3, padding: "4px 12px",
                }}>
                  {meta.icon} {meta.label}
                </span>
              </div>

              <div style={{ background: "#0a0a0a", border: "1px solid #111", borderRadius: 10, padding: "18px", marginBottom: 14 }}>
                <div style={{ fontSize: 8, color: "#222", letterSpacing: 4, marginBottom: 14, fontFamily: "monospace" }}>
                  PRICE HISTORY — {data.prices?.length || 0} POINTS
                </div>
                <Sparkline prices={data.prices} color={meta.color} width={360} height={100} />
                {data.prices?.length > 0 && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, marginTop: 16, paddingTop: 14, borderTop: "1px solid #111" }}>
                    {[
                      { label: "OPEN", val: data.price_open },
                      { label: "HIGH", val: data.price_high, color: "#14F195" },
                      { label: "LOW",  val: data.price_low,  color: "#ff3b5c" },
                      { label: "LAST", val: data.price_now },
                    ].map(({ label, val, color }) => (
                      <div key={label} style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 7, color: "#222", letterSpacing: 2, marginBottom: 4 }}>{label}</div>
                        <div style={{ fontSize: 13, color: color || "#999", fontWeight: 600 }}>{fmt(val)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
                {[
                  { label: "FIRST SEEN",   val: fmtAge(data.first_seen) },
                  { label: "LAST SIGNAL",  val: relTime(data.last_seen * 1000) },
                  { label: "ALPHA SCORE",  val: "★".repeat(data.score || 0) + "☆".repeat(Math.max(0, 5 - (data.score || 0))) },
                  { label: "SIGNAL COUNT", val: data.signals?.length || 0 },
                ].map(({ label, val }) => (
                  <div key={label} style={{ background: "#0a0a0a", border: "1px solid #111", borderRadius: 8, padding: "14px 16px" }}>
                    <div style={{ fontSize: 7, color: "#222", letterSpacing: 3, marginBottom: 6 }}>{label}</div>
                    <div style={{ fontSize: 15, color: "#ccc", fontWeight: 600 }}>{val}</div>
                  </div>
                ))}
              </div>

              {data.signals?.length > 0 && (
                <div style={{ background: "#0a0a0a", border: "1px solid #111", borderRadius: 10, padding: "16px 18px" }}>
                  <div style={{ fontSize: 8, color: "#222", letterSpacing: 4, marginBottom: 12 }}>SIGNAL HISTORY</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {[...data.signals].reverse().map((sig, i) => {
                      const m = TYPE_META[sig] || {};
                      return (
                        <span key={i} style={{
                          fontSize: 9, color: m.color || "#333",
                          background: `${m.color || "#333"}10`,
                          border: `1px solid ${m.color || "#222"}28`,
                          borderRadius: 3, padding: "3px 8px", letterSpacing: 1,
                        }}>
                          {m.icon} {m.label || sig}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

// ─── SCORE BADGE ─────────────────────────────────────────────────────────────
function ScoreBadge({ score = 0 }) {
  return (
    <span style={{ letterSpacing: 1, fontSize: 11 }}>
      {Array.from({ length: 5 }).map((_, i) => (
        <span key={i} style={{ color: i < score ? "#f7c948" : "#1c1c1c" }}>★</span>
      ))}
    </span>
  );
}

// ─── STAT BOX ────────────────────────────────────────────────────────────────
function StatBox({ label, value, color = "#fff", delta }) {
  return (
    <div style={{
      background: "#080808",
      border: "1px solid #111",
      borderRadius: 10,
      padding: "14px 20px",
      minWidth: 130,
      position: "relative",
      overflow: "hidden",
    }}>
      {/* accent corner */}
      <div style={{
        position: "absolute", top: 0, right: 0,
        width: 40, height: 40,
        background: `radial-gradient(circle at top right, ${color}15, transparent)`,
      }} />
      <div style={{ fontSize: 8, color: "#222", fontFamily: "monospace", letterSpacing: 3, marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 28, fontFamily: "'Space Mono', monospace", color, fontWeight: 700, lineHeight: 1 }}>{value}</div>
    </div>
  );
}

// ─── EVENT CARD ──────────────────────────────────────────────────────────────
function EventCard({ event, fresh, onClick }) {
  const meta = TYPE_META[event.type] || { icon: "?", label: event.type, color: "#555", bg: "#090909", glow: "#555" };
  const [hovered, setHovered] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // staggered mount animation
    const t = setTimeout(() => setVisible(true), 30);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      onClick={() => onClick(event.token)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        background: hovered
          ? `linear-gradient(90deg, ${meta.color}08, transparent)`
          : fresh
          ? meta.bg
          : "transparent",
        border: `1px solid ${fresh ? meta.color + "66" : hovered ? "#1e1e1e" : "#0f0f0f"}`,
        borderLeft: `2px solid ${fresh ? meta.color : hovered ? meta.color + "55" : "#1a1a1a"}`,
        borderRadius: 8,
        padding: "11px 16px",
        marginBottom: 4,
        transition: "all 0.25s ease",
        cursor: "pointer",
        fontFamily: "'Space Mono', monospace",
        fontSize: 12,
        boxShadow: fresh ? `0 0 20px ${meta.glow}18, inset 0 0 20px ${meta.glow}04` : "none",
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0) translateX(0)" : "translateY(-8px)",
        willChange: "transform, opacity",
      }}
    >
      {/* type icon */}
      <span style={{
        fontSize: 16, color: meta.color, minWidth: 20, textAlign: "center",
        filter: fresh ? `drop-shadow(0 0 6px ${meta.color})` : "none",
        transition: "filter 0.3s",
      }}>{meta.icon}</span>

      {/* type pill */}
      <span style={{
        fontSize: 8, fontWeight: 700, letterSpacing: 2,
        color: meta.color,
        background: `${meta.color}14`,
        border: `1px solid ${meta.color}33`,
        borderRadius: 3,
        padding: "3px 8px",
        minWidth: 76, textAlign: "center",
        whiteSpace: "nowrap",
      }}>
        {meta.label}
      </span>

      {/* token */}
      <span style={{ color: fresh ? "#fff" : "#aaa", fontWeight: 600, flex: 1, letterSpacing: 0.5 }}>
        {event.token}
      </span>

      {/* value */}
      <span style={{
        color: meta.color, fontWeight: 700, minWidth: 85, textAlign: "right",
        fontSize: 13,
        textShadow: fresh ? `0 0 12px ${meta.color}88` : "none",
      }}>
        {fmt(event.usd || 0)}
      </span>

      <ScoreBadge score={event.score || 0} />

      <span style={{ color: "#252525", fontSize: 10, minWidth: 64, textAlign: "right" }}>
        {relTime(event.timestamp)}
      </span>

      <span style={{ color: hovered ? "#555" : "transparent", fontSize: 14, transition: "color 0.15s", minWidth: 14 }}>›</span>
    </div>
  );
}

// ─── TICKER ──────────────────────────────────────────────────────────────────
function TickerBar({ events }) {
  return (
    <div style={{
      background: "#050505",
      borderBottom: "1px solid #0d0d0d",
      padding: "7px 28px",
      display: "flex",
      gap: 36,
      overflow: "hidden",
      fontSize: 10,
      fontFamily: "'Space Mono', monospace",
      letterSpacing: 1,
    }}>
      {events.slice(0, 10).map((e) => {
        const meta = TYPE_META[e.type] || {};
        return (
          <span key={e.id} style={{ color: meta.color || "#333", whiteSpace: "nowrap", opacity: 0.8 }}>
            {meta.icon} <span style={{ opacity: 0.6 }}>{e.token}</span> {fmt(e.usd || 0)}
          </span>
        );
      })}
      {events.length === 0 && (
        <span style={{ color: "#1a1a1a", letterSpacing: 4 }}>AWAITING SIGNALS</span>
      )}
    </div>
  );
}

// ─── FILTER BAR ──────────────────────────────────────────────────────────────
function FilterBar({ active, onChange, counts }) {
  const filters = [
    { key: "all",          label: "ALL",       color: "#555" },
    { key: "whale",        label: "WHALE",     color: TYPE_META.whale.color },
    { key: "volume_spike", label: "VOL SPIKE", color: TYPE_META.volume_spike.color },
    { key: "new_token",    label: "NEW TOKEN", color: TYPE_META.new_token.color },
  ];
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 18, alignItems: "center" }}>
      {filters.map(f => {
        const isActive = active === f.key;
        const count = counts[f.key] || 0;
        return (
          <button key={f.key} onClick={() => onChange(f.key)} style={{
            background: isActive ? `${f.color}14` : "transparent",
            border: `1px solid ${isActive ? f.color + "66" : "#141414"}`,
            color: isActive ? f.color : "#333",
            borderRadius: 5,
            padding: "5px 14px",
            fontSize: 9,
            fontFamily: "'Space Mono', monospace",
            letterSpacing: 2,
            cursor: "pointer",
            transition: "all 0.18s ease",
            display: "flex", alignItems: "center", gap: 7,
          }}>
            <span>{f.label}</span>
            {f.key !== "all" && count > 0 && (
              <span style={{
                background: `${f.color}22`, color: f.color,
                borderRadius: 3, padding: "1px 5px", fontSize: 8,
              }}>{count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ─── QUEUE BADGE ─────────────────────────────────────────────────────────────
function QueueBadge({ count }) {
  if (count === 0) return null;
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      background: "#0e0e0e", border: "1px solid #1a1a1a",
      borderRadius: 5, padding: "4px 12px",
      fontSize: 9, fontFamily: "monospace", letterSpacing: 2, color: "#333",
      marginLeft: "auto",
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#f7c948", animation: "pulse 1s ease infinite", display: "inline-block" }} />
      {count} QUEUED
    </div>
  );
}

// ─── APP ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [feed, setFeed]               = useState([]);
  const [pendingQueue, setPending]    = useState([]);
  const [filter, setFilter]           = useState("all");
  const [wsStatus, setWsStatus]       = useState("connecting");
  const [stats, setStats]             = useState({ total: 0, whales: 0, spikes: 0, newTokens: 0 });
  const [selectedToken, setSelected]  = useState(null);
  const [, setTick]                   = useState(0);
  const freshIds                       = useRef(new Set());
  const pendingRef                     = useRef([]);

  // Keep ref in sync with state for the interval callback
  useEffect(() => { pendingRef.current = pendingQueue; }, [pendingQueue]);

  // Release one item from the queue at a time
  useEffect(() => {
    const interval = setInterval(() => {
      if (pendingRef.current.length === 0) return;
      const [next, ...rest] = pendingRef.current;
      setPending(rest);
      const event = { ...next, id: `${Date.now()}-${Math.random()}`, timestamp: Date.now() };
      freshIds.current.add(event.id);
      setTimeout(() => freshIds.current.delete(event.id), FRESH_MS);
      setFeed(prev => [event, ...prev].slice(0, MAX_FEED));
      setStats(prev => ({
        total:     prev.total + 1,
        whales:    prev.whales    + (next.type === "whale"        ? 1 : 0),
        spikes:    prev.spikes    + (next.type === "volume_spike" ? 1 : 0),
        newTokens: prev.newTokens + (next.type === "new_token"   ? 1 : 0),
      }));
    }, RELEASE_INTERVAL);
    return () => clearInterval(interval);
  }, []);

  // WebSocket
  const addToQueue = useCallback((raw) => {
    setPending(prev => [...prev, raw]);
  }, []);

  useEffect(() => {
    let reconnectTimer;
    function connect() {
      const ws = new WebSocket(WS_URL);
      ws.onopen    = () => setWsStatus("live");
      ws.onclose   = () => { setWsStatus("reconnecting"); reconnectTimer = setTimeout(connect, 3000); };
      ws.onerror   = () => setWsStatus("error");
      ws.onmessage = (e) => { try { addToQueue(JSON.parse(e.data)); } catch {} };
    }
    connect();
    return () => clearTimeout(reconnectTimer);
  }, [addToQueue]);

  // Tick for relative timestamps
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 5000);
    return () => clearInterval(t);
  }, []);

  const filtered = filter === "all" ? feed : feed.filter(e => e.type === filter);
  const visible  = filtered.slice(0, MAX_VISIBLE);

  const statusColor = { live: "#14F195", reconnecting: "#f7c948", error: "#ff3b5c", connecting: "#222" }[wsStatus];
  const statusLabel = { live: "LIVE", reconnecting: "RECONNECTING", error: "ERROR", connecting: "CONNECTING" }[wsStatus];

  const filterCounts = {
    whale:        stats.whales,
    volume_spike: stats.spikes,
    new_token:    stats.newTokens,
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { background: #040404; }
        
        @keyframes slideDown  { from { opacity:0; transform:translateY(-10px); } to { opacity:1; transform:translateY(0); } }
        @keyframes fadeIn     { from { opacity:0; } to { opacity:1; } }
        @keyframes drawerIn   { from { transform:translateX(100%); } to { transform:translateX(0); } }
        @keyframes pulse      { 0%,100%{opacity:1;} 50%{opacity:0.35;} }
        @keyframes scanMove   { from{background-position:0 0;} to{background-position:0 100%;} }
        @keyframes glow       { 0%,100%{opacity:0.6;} 50%{opacity:1;} }
        @keyframes floatUp    { from{opacity:0;transform:translateY(4px);} to{opacity:1;transform:translateY(0);} }

        ::-webkit-scrollbar       { width: 3px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #1a1a1a; border-radius: 2px; }

        .card-enter {
          animation: floatUp 0.3s ease forwards;
        }
      `}</style>

      <ScanLines />
      <NoiseOverlay />

      <div style={{ background: "#040404", minHeight: "100vh", color: "#e8e8e8", fontFamily: "'Space Mono', monospace" }}>

        {/* ── HEADER ── */}
        <header style={{
          padding: "0 36px",
          height: 64,
          borderBottom: "1px solid #0c0c0c",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          background: "linear-gradient(180deg, #080808 0%, #040404 100%)",
          position: "sticky", top: 0, zIndex: 50,
        }}>
          {/* logo */}
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{
              width: 34, height: 34,
              background: "linear-gradient(135deg, #9945FF 0%, #14F195 100%)",
              borderRadius: 8,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 16, boxShadow: "0 0 20px rgba(153,69,255,0.4)",
            }}>⚡</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, letterSpacing: 3, color: "#fff", lineHeight: 1 }}>
                SOLANA ALPHA
              </div>
              <div style={{ fontSize: 7, color: "#1e1e1e", letterSpacing: 4, marginTop: 3 }}>
                SIGNAL TERMINAL
              </div>
            </div>
          </div>

          {/* center — queue indicator */}
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {pendingQueue.length > 0 && (
              <div style={{
                fontSize: 9, letterSpacing: 2, color: "#f7c948",
                background: "rgba(247,201,72,0.08)", border: "1px solid rgba(247,201,72,0.2)",
                borderRadius: 4, padding: "4px 12px",
                animation: "pulse 1.5s ease infinite",
              }}>
                ▲ {pendingQueue.length} INCOMING
              </div>
            )}
          </div>

          {/* status */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 10 }}>
            <div style={{
              width: 6, height: 6, borderRadius: "50%",
              background: statusColor,
              boxShadow: `0 0 8px ${statusColor}`,
              animation: wsStatus === "live" ? "pulse 2s ease infinite" : "none",
            }} />
            <span style={{ color: statusColor, letterSpacing: 3 }}>{statusLabel}</span>
          </div>
        </header>

        {/* ── TICKER ── */}
        <TickerBar events={feed} />

        {/* ── BODY ── */}
        <main style={{ padding: "28px 36px", maxWidth: 1100, margin: "0 auto" }}>

          {/* STATS ROW */}
          <div style={{ display: "flex", gap: 10, marginBottom: 28, flexWrap: "wrap" }}>
            <StatBox label="TOTAL SIGNALS"  value={stats.total}     color="#e8e8e8" />
            <StatBox label="WHALE TRADES"   value={stats.whales}    color="#ff3b5c" />
            <StatBox label="VOL SPIKES"     value={stats.spikes}    color="#f7c948" />
            <StatBox label="NEW TOKENS"     value={stats.newTokens} color="#00e5ff" />
          </div>

          {/* FILTER + QUEUE COUNT */}
          <div style={{ display: "flex", alignItems: "center", marginBottom: 6, gap: 12 }}>
            <FilterBar active={filter} onChange={setFilter} counts={filterCounts} />
            <QueueBadge count={pendingQueue.length} />
          </div>

          {/* COLUMN HEADERS */}
          <div style={{
            display: "flex", gap: 14, padding: "5px 16px",
            fontSize: 7, letterSpacing: 3, color: "#1c1c1c", marginBottom: 6,
          }}>
            <span style={{ minWidth: 20 }} />
            <span style={{ minWidth: 76 }}>TYPE</span>
            <span style={{ flex: 1 }}>TOKEN</span>
            <span style={{ minWidth: 85, textAlign: "right" }}>VALUE</span>
            <span style={{ minWidth: 60 }}>SCORE</span>
            <span style={{ minWidth: 64, textAlign: "right" }}>TIME</span>
            <span style={{ minWidth: 14 }} />
          </div>

          {/* FEED */}
          <div>
            {visible.length === 0 ? (
              <div style={{
                textAlign: "center", color: "#141414",
                fontSize: 11, padding: "80px 0", letterSpacing: 4,
                animation: "pulse 3s ease infinite",
              }}>
                AWAITING SIGNALS
              </div>
            ) : (
              visible.map((e, i) => (
                <EventCard
                  key={e.id}
                  event={e}
                  fresh={freshIds.current.has(e.id)}
                  onClick={setSelected}
                />
              ))
            )}
          </div>

          {filtered.length > MAX_VISIBLE && (
            <div style={{ textAlign: "center", color: "#1a1a1a", fontSize: 9, fontFamily: "monospace", letterSpacing: 3, marginTop: 16 }}>
              + {filtered.length - MAX_VISIBLE} OLDER SIGNALS
            </div>
          )}
        </main>
      </div>

      {/* DRAWER */}
      {selectedToken && (
        <TokenDrawer token={selectedToken} onClose={() => setSelected(null)} />
      )}
    </>
  );
}