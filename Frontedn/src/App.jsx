import { useEffect, useState, useRef, useCallback } from "react";

const MAX_FEED    = 80;
const MAX_VISIBLE = 25;
const WS_URL      = "ws://localhost:8000/ws";
const API_URL     = "http://localhost:8000";

const TYPE_META = {
  whale:        { icon: "◈", label: "WHALE",    color: "#ff3b5c", bg: "rgba(255,59,92,0.08)",  glow: "#ff3b5c" },
  volume_spike: { icon: "▲", label: "VOL SPIKE", color: "#f7c948", bg: "rgba(247,201,72,0.07)", glow: "#f7c948" },
  new_token:    { icon: "✦", label: "NEW TOKEN", color: "#00e5ff", bg: "rgba(0,229,255,0.06)",  glow: "#00e5ff" },
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

// ─── SPARKLINE ──────────────────────────────────────────────────────────────
function Sparkline({ prices, color, width = 340, height = 90 }) {
  if (!prices || prices.length < 2) {
    return (
      <div style={{ width, height, display: "flex", alignItems: "center", justifyContent: "center", color: "#2a2a2a", fontSize: 12, fontFamily: "monospace" }}>
        NOT ENOUGH DATA
      </div>
    );
  }

  const values = prices.map(p => p.usd);
  const min    = Math.min(...values);
  const max    = Math.max(...values);
  const range  = max - min || 1;

  const pad = 8;
  const W = width  - pad * 2;
  const H = height - pad * 2;

  const points = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * W;
    const y = pad + H - ((v - min) / range) * H;
    return `${x},${y}`;
  });

  const polyline = points.join(" ");

  // fill path
  const firstPt = points[0].split(",");
  const lastPt  = points[points.length - 1].split(",");
  const fillPath = `M${firstPt[0]},${height} L${polyline.replace(/,/g, " L").split(" L").join(" L")} L${lastPt[0]},${height} Z`
    .replace("M", "M")
    .replace(/L(\S+) L(\S+)/g, (_, x, y) => `L${x},${y}`);

  // simpler fill
  const fillD = `M ${firstPt[0]} ${height} ${points.map(p => `L ${p.replace(",", " ")}`).join(" ")} L ${lastPt[0]} ${height} Z`;

  const isUp = values[values.length - 1] >= values[0];
  const lineColor = isUp ? "#14F195" : "#ff3b5c";

  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      <defs>
        <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={lineColor} stopOpacity="0.25" />
          <stop offset="100%" stopColor={lineColor} stopOpacity="0"    />
        </linearGradient>
      </defs>
      {/* fill */}
      <path d={fillD} fill="url(#sparkGrad)" />
      {/* line */}
      <polyline
        points={polyline}
        fill="none"
        stroke={lineColor}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* last dot */}
      <circle
        cx={lastPt[0]}
        cy={lastPt[1]}
        r="3.5"
        fill={lineColor}
        style={{ filter: `drop-shadow(0 0 4px ${lineColor})` }}
      />
    </svg>
  );
}

// ─── SLIDE-OUT DRAWER ────────────────────────────────────────────────────────
function TokenDrawer({ token, onClose }) {
  const [data, setData]     = useState(null);
  const [loading, setLoad]  = useState(true);
  const [error, setError]   = useState(null);

  useEffect(() => {
    if (!token) return;
    setLoad(true);
    setError(null);
    fetch(`${API_URL}/token/${token}`)
      .then(r => {
        if (!r.ok) throw new Error("Token not found");
        return r.json();
      })
      .then(d => { setData(d); setLoad(false); })
      .catch(e => { setError(e.message); setLoad(false); });
  }, [token]);

  const meta = TYPE_META[data?.type] || TYPE_META.new_token;

  return (
    <>
      {/* backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0,
          background: "rgba(0,0,0,0.6)",
          zIndex: 99,
          animation: "fadeIn 0.2s ease",
        }}
      />

      {/* drawer */}
      <div style={{
        position: "fixed",
        top: 0, right: 0, bottom: 0,
        width: 420,
        background: "#0a0a0a",
        borderLeft: "1px solid #1a1a1a",
        zIndex: 100,
        display: "flex",
        flexDirection: "column",
        animation: "drawerIn 0.25s cubic-bezier(0.16,1,0.3,1)",
        fontFamily: "'JetBrains Mono', monospace",
      }}>

        {/* header */}
        <div style={{
          padding: "20px 24px 16px",
          borderBottom: "1px solid #111",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}>
          <div>
            <div style={{ fontSize: 9, color: "#333", letterSpacing: 3, marginBottom: 6 }}>TOKEN DETAIL</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: "#fff", letterSpacing: -0.5 }}>
              {token}
            </div>
          </div>
          <button onClick={onClose} style={{
            background: "#111",
            border: "1px solid #222",
            color: "#666",
            width: 32, height: 32,
            borderRadius: 6,
            cursor: "pointer",
            fontSize: 16,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>✕</button>
        </div>

        {/* body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>

          {loading && (
            <div style={{ color: "#333", textAlign: "center", paddingTop: 60, letterSpacing: 2, fontSize: 12 }}>
              LOADING...
            </div>
          )}

          {error && (
            <div style={{ color: "#ff3b5c", textAlign: "center", paddingTop: 60, fontSize: 12 }}>
              {error}
            </div>
          )}

          {data && !loading && (
            <>
              {/* type badge */}
              <div style={{ marginBottom: 20 }}>
                <span style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: 2,
                  color: meta.color,
                  background: `${meta.color}15`,
                  border: `1px solid ${meta.color}44`,
                  borderRadius: 4,
                  padding: "3px 10px",
                }}>
                  {meta.icon} {meta.label}
                </span>
              </div>

              {/* sparkline section */}
              <div style={{
                background: "#0e0e0e",
                border: "1px solid #161616",
                borderRadius: 10,
                padding: "16px",
                marginBottom: 16,
              }}>
                <div style={{ fontSize: 9, color: "#333", letterSpacing: 3, marginBottom: 12 }}>
                  TRADE VALUE HISTORY ({data.prices?.length || 0} points)
                </div>
                <Sparkline prices={data.prices} color={meta.color} width={340} height={90} />

                {/* OHLC-style row */}
                {data.prices?.length > 0 && (
                  <div style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr 1fr 1fr",
                    gap: 8,
                    marginTop: 14,
                    paddingTop: 14,
                    borderTop: "1px solid #141414",
                  }}>
                    {[
                      { label: "OPEN",  val: data.price_open },
                      { label: "HIGH",  val: data.price_high, color: "#14F195" },
                      { label: "LOW",   val: data.price_low,  color: "#ff3b5c" },
                      { label: "LAST",  val: data.price_now  },
                    ].map(({ label, val, color }) => (
                      <div key={label} style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 8, color: "#333", letterSpacing: 2, marginBottom: 3 }}>{label}</div>
                        <div style={{ fontSize: 12, color: color || "#aaa", fontWeight: 600 }}>{fmt(val)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* meta row */}
              <div style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 10,
                marginBottom: 16,
              }}>
                {[
                  { label: "FIRST SEEN",  val: fmtAge(data.first_seen) },
                  { label: "LAST SIGNAL", val: relTime(data.last_seen * 1000) },
                  { label: "ALPHA SCORE", val: "★".repeat(data.score || 0) + "☆".repeat(Math.max(0, 5 - (data.score || 0))) },
                  { label: "SIGNAL COUNT", val: data.signals?.length || 0 },
                ].map(({ label, val }) => (
                  <div key={label} style={{
                    background: "#0e0e0e",
                    border: "1px solid #161616",
                    borderRadius: 8,
                    padding: "12px 14px",
                  }}>
                    <div style={{ fontSize: 8, color: "#333", letterSpacing: 2, marginBottom: 5 }}>{label}</div>
                    <div style={{ fontSize: 14, color: "#ccc", fontWeight: 600 }}>{val}</div>
                  </div>
                ))}
              </div>

              {/* signal history */}
              {data.signals?.length > 0 && (
                <div style={{
                  background: "#0e0e0e",
                  border: "1px solid #161616",
                  borderRadius: 10,
                  padding: "14px 16px",
                }}>
                  <div style={{ fontSize: 9, color: "#333", letterSpacing: 3, marginBottom: 10 }}>SIGNAL HISTORY</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {[...data.signals].reverse().map((sig, i) => {
                      const m = TYPE_META[sig] || {};
                      return (
                        <span key={i} style={{
                          fontSize: 9,
                          color: m.color || "#444",
                          background: `${m.color || "#444"}12`,
                          border: `1px solid ${m.color || "#333"}33`,
                          borderRadius: 3,
                          padding: "2px 7px",
                          letterSpacing: 1,
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

// ─── SCORE STARS ─────────────────────────────────────────────────────────────
function ScoreBadge({ score = 0 }) {
  return (
    <span style={{ letterSpacing: 1, fontSize: 11 }}>
      {Array.from({ length: 5 }).map((_, i) => (
        <span key={i} style={{ color: i < score ? "#f7c948" : "#222" }}>★</span>
      ))}
    </span>
  );
}

// ─── STAT BOX ────────────────────────────────────────────────────────────────
function StatBox({ label, value, color = "#fff" }) {
  return (
    <div style={{
      background: "#0e0e0e",
      border: "1px solid #1a1a1a",
      borderRadius: 8,
      padding: "10px 18px",
      minWidth: 120,
    }}>
      <div style={{ fontSize: 10, color: "#333", fontFamily: "monospace", letterSpacing: 2, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontFamily: "'JetBrains Mono', monospace", color, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

// ─── EVENT CARD ──────────────────────────────────────────────────────────────
function EventCard({ event, fresh, onClick }) {
  const meta = TYPE_META[event.type] || { icon: "?", label: event.type, color: "#888", bg: "#111", glow: "#888" };
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onClick={() => onClick(event.token)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        background: hovered ? "#111" : meta.bg,
        border: `1px solid ${fresh ? meta.color : hovered ? "#2a2a2a" : "#161616"}`,
        borderLeft: `3px solid ${meta.color}`,
        borderRadius: 6,
        padding: "9px 14px",
        marginBottom: 5,
        transition: "all 0.15s ease",
        opacity: fresh ? 1 : 0.75,
        boxShadow: fresh ? `0 0 12px ${meta.glow}22` : "none",
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        fontSize: 13,
        cursor: "pointer",
        animation: fresh ? "slideIn 0.2s ease" : "none",
      }}
    >
      <span style={{ fontSize: 18, color: meta.color, minWidth: 22, textAlign: "center" }}>{meta.icon}</span>

      <span style={{
        fontSize: 9, fontWeight: 700, letterSpacing: 2,
        color: meta.color,
        background: `${meta.color}18`,
        border: `1px solid ${meta.color}44`,
        borderRadius: 3,
        padding: "2px 6px",
        minWidth: 72, textAlign: "center",
      }}>
        {meta.label}
      </span>

      <span style={{ color: "#e8e8e8", fontWeight: 600, minWidth: 80, flex: 1 }}>{event.token}</span>
      <span style={{ color: meta.color, fontWeight: 700, minWidth: 80, textAlign: "right" }}>{fmt(event.usd || 0)}</span>
      <ScoreBadge score={event.score || 0} />
      <span style={{ color: "#2a2a2a", fontSize: 11, minWidth: 60, textAlign: "right" }}>{relTime(event.timestamp)}</span>

      {/* click hint */}
      <span style={{
        color: hovered ? "#444" : "transparent",
        fontSize: 11,
        transition: "color 0.15s",
        minWidth: 16,
      }}>›</span>
    </div>
  );
}

// ─── TICKER ──────────────────────────────────────────────────────────────────
function TickerBar({ events }) {
  return (
    <div style={{
      background: "#090909",
      borderBottom: "1px solid #111",
      padding: "6px 24px",
      display: "flex",
      gap: 32,
      overflow: "hidden",
      fontSize: 11,
      fontFamily: "monospace",
    }}>
      {events.slice(0, 8).map((e) => {
        const meta = TYPE_META[e.type] || {};
        return (
          <span key={e.id} style={{ color: meta.color || "#666", whiteSpace: "nowrap" }}>
            {meta.icon} {e.token} {fmt(e.usd || 0)}
          </span>
        );
      })}
    </div>
  );
}

// ─── FILTER BAR ──────────────────────────────────────────────────────────────
function FilterBar({ active, onChange }) {
  const filters = ["all", "whale", "volume_spike", "new_token"];
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
      {filters.map(f => {
        const meta = f === "all" ? { color: "#888", label: "ALL" } : { ...TYPE_META[f], label: TYPE_META[f]?.label };
        const isActive = active === f;
        return (
          <button key={f} onClick={() => onChange(f)} style={{
            background: isActive ? `${meta.color}18` : "transparent",
            border: `1px solid ${isActive ? meta.color : "#1e1e1e"}`,
            color: isActive ? meta.color : "#444",
            borderRadius: 4,
            padding: "4px 12px",
            fontSize: 11,
            fontFamily: "monospace",
            letterSpacing: 1,
            cursor: "pointer",
            transition: "all 0.15s",
          }}>
            {meta.label || f.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}

// ─── APP ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [feed, setFeed]             = useState([]);
  const [filter, setFilter]         = useState("all");
  const [wsStatus, setWsStatus]     = useState("connecting");
  const [stats, setStats]           = useState({ total: 0, whales: 0, spikes: 0, newTokens: 0 });
  const [selectedToken, setSelected] = useState(null);
  const freshIds = useRef(new Set());

  const addEvent = useCallback((raw) => {
    const event = { ...raw, id: `${Date.now()}-${Math.random()}`, timestamp: Date.now() };
    freshIds.current.add(event.id);
    setTimeout(() => freshIds.current.delete(event.id), 3000);
    setFeed(prev => [event, ...prev].slice(0, MAX_FEED));
    setStats(prev => ({
      total:     prev.total + 1,
      whales:    prev.whales    + (raw.type === "whale"        ? 1 : 0),
      spikes:    prev.spikes    + (raw.type === "volume_spike" ? 1 : 0),
      newTokens: prev.newTokens + (raw.type === "new_token"   ? 1 : 0),
    }));
  }, []);

  useEffect(() => {
    let reconnectTimer;
    function connect() {
      const ws = new WebSocket(WS_URL);
      ws.onopen    = () => setWsStatus("live");
      ws.onclose   = () => { setWsStatus("reconnecting"); reconnectTimer = setTimeout(connect, 3000); };
      ws.onerror   = () => setWsStatus("error");
      ws.onmessage = (e) => { try { addEvent(JSON.parse(e.data)); } catch {} };
    }
    connect();
    return () => clearTimeout(reconnectTimer);
  }, [addEvent]);

  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 5000);
    return () => clearInterval(t);
  }, []);

  const filtered = filter === "all" ? feed : feed.filter(e => e.type === filter);
  const visible  = filtered.slice(0, MAX_VISIBLE);
  const statusColor = { live: "#00e5ff", reconnecting: "#f7c948", error: "#ff3b5c", connecting: "#333" }[wsStatus];

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #060606; }
        @keyframes slideIn   { from { transform: translateY(-6px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        @keyframes fadeIn    { from { opacity: 0; } to { opacity: 1; } }
        @keyframes drawerIn  { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @keyframes pulse     { 0%,100% { opacity:1; } 50% { opacity:0.4; } }
        ::-webkit-scrollbar       { width: 4px; }
        ::-webkit-scrollbar-track { background: #0a0a0a; }
        ::-webkit-scrollbar-thumb { background: #1e1e1e; border-radius: 2px; }
      `}</style>

      <div style={{ background: "#060606", minHeight: "100vh", color: "#e8e8e8" }}>

        {/* HEADER */}
        <div style={{
          padding: "18px 32px",
          borderBottom: "1px solid #0f0f0f",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          background: "#080808",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{
              width: 36, height: 36,
              background: "linear-gradient(135deg, #9945FF, #14F195)",
              borderRadius: 8,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 18,
            }}>⚡</div>
            <div>
              <div style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 18, letterSpacing: 2, color: "#fff" }}>
                SOLANA ALPHA
              </div>
              <div style={{ fontSize: 9, color: "#2a2a2a", letterSpacing: 3, fontFamily: "monospace" }}>
                REAL-TIME SIGNAL TERMINAL
              </div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: "monospace", fontSize: 12 }}>
            <span style={{
              width: 7, height: 7, borderRadius: "50%",
              background: statusColor,
              display: "inline-block",
              animation: wsStatus === "live" ? "pulse 2s ease infinite" : "none",
              boxShadow: `0 0 6px ${statusColor}`,
            }}/>
            <span style={{ color: statusColor, letterSpacing: 2, textTransform: "uppercase" }}>{wsStatus}</span>
          </div>
        </div>

        {/* TICKER */}
        <TickerBar events={feed} />

        {/* BODY */}
        <div style={{ padding: "24px 32px" }}>

          {/* STATS */}
          <div style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
            <StatBox label="TOTAL SIGNALS"  value={stats.total}     color="#e8e8e8" />
            <StatBox label="WHALE TRADES"   value={stats.whales}    color="#ff3b5c" />
            <StatBox label="VOL SPIKES"     value={stats.spikes}    color="#f7c948" />
            <StatBox label="NEW TOKENS"     value={stats.newTokens} color="#00e5ff" />
          </div>

          {/* FILTER */}
          <FilterBar active={filter} onChange={setFilter} />

          {/* COLUMN HEADERS */}
          <div style={{
            display: "flex", gap: 12, padding: "4px 14px",
            fontSize: 9, fontFamily: "monospace", letterSpacing: 2, color: "#222", marginBottom: 4,
          }}>
            <span style={{ minWidth: 22 }} />
            <span style={{ minWidth: 72 }}>TYPE</span>
            <span style={{ flex: 1 }}>TOKEN</span>
            <span style={{ minWidth: 80, textAlign: "right" }}>VALUE</span>
            <span style={{ minWidth: 55 }}>SCORE</span>
            <span style={{ minWidth: 60, textAlign: "right" }}>TIME</span>
            <span style={{ minWidth: 16 }} />
          </div>

          {/* FEED */}
          {visible.length === 0 ? (
            <div style={{
              textAlign: "center", color: "#1e1e1e",
              fontFamily: "monospace", fontSize: 13,
              padding: "60px 0", letterSpacing: 2,
            }}>
              WAITING FOR SIGNALS...
            </div>
          ) : (
            visible.map(e => (
              <EventCard
                key={e.id}
                event={e}
                fresh={Date.now() - e.timestamp < 3000}
                onClick={setSelected}
              />
            ))
          )}

          {filtered.length > MAX_VISIBLE && (
            <div style={{ textAlign: "center", color: "#222", fontSize: 11, fontFamily: "monospace", marginTop: 12 }}>
              + {filtered.length - MAX_VISIBLE} older signals
            </div>
          )}
        </div>
      </div>

      {/* DRAWER */}
      {selectedToken && (
        <TokenDrawer token={selectedToken} onClose={() => setSelected(null)} />
      )}
    </>
  );
}