// Hand-authored inline-SVG diagrams for the /architecture page.
// No chart/diagram library — plain React SVG so the page ships with zero extra
// client JS and renders identically everywhere. Coordinates are computed from
// box geometry (not eyeballed), so lines always meet the box edges.

type B = { x: number; y: number; w: number; h: number };

const midX = (b: B) => b.x + b.w / 2;
const midY = (b: B) => b.y + b.h / 2;
export const top = (b: B) => ({ x: midX(b), y: b.y });
export const bottom = (b: B) => ({ x: midX(b), y: b.y + b.h });
export const left = (b: B) => ({ x: b.x, y: midY(b) });
export const right = (b: B) => ({ x: b.x + b.w, y: midY(b) });

const NAVY = "#1f3864";
const BLUE = "#2e75b6";
const MUTED = "#667";
const LINE = "#aab2c0";

export function ArrowDefs({ id }: { id: string }) {
  return (
    <defs>
      <marker
        id={id}
        viewBox="0 0 10 10"
        refX="8.5"
        refY="5"
        markerWidth="7"
        markerHeight="7"
        orient="auto-start-reverse"
      >
        <path d="M0,0 L10,5 L0,10 z" fill={LINE} />
      </marker>
    </defs>
  );
}

export function FlowBox({
  b,
  title,
  sub,
  dashed,
  accent = BLUE,
}: {
  b: B;
  title: string;
  sub?: string[];
  dashed?: boolean;
  accent?: string;
}) {
  return (
    <g>
      <rect
        x={b.x}
        y={b.y}
        width={b.w}
        height={b.h}
        rx={10}
        fill="#fff"
        stroke={dashed ? "#9aa4b5" : "#d8dde6"}
        strokeWidth={1.3}
        strokeDasharray={dashed ? "5 4" : undefined}
      />
      <rect x={b.x} y={b.y} width={4} height={b.h} rx={2} fill={accent} />
      <text x={b.x + 14} y={b.y + 22} fontSize={12.5} fontWeight={700} fill={NAVY}>
        {title}
      </text>
      {sub?.map((line, i) => (
        <text key={i} x={b.x + 14} y={b.y + 40 + i * 15} fontSize={11} fill={MUTED}>
          {line}
        </text>
      ))}
    </g>
  );
}

export function Arrow({
  x1,
  y1,
  x2,
  y2,
  markerId,
  label,
  dashed,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  markerId: string;
  label?: string;
  dashed?: boolean;
}) {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  return (
    <g>
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={LINE}
        strokeWidth={1.5}
        strokeDasharray={dashed ? "4 3" : undefined}
        markerEnd={`url(#${markerId})`}
      />
      {label && (
        <g>
          <rect
            x={mx - label.length * 3.15}
            y={my - 9}
            width={label.length * 6.3}
            height={14}
            fill="#f6f7f9"
          />
          <text x={mx} y={my + 2} fontSize={10} textAnchor="middle" fill="#556">
            {label}
          </text>
        </g>
      )}
    </g>
  );
}

function RelLine({
  x1,
  y1,
  x2,
  y2,
  label,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label: string;
}) {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  return (
    <g>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={LINE} strokeWidth={1.2} />
      <circle cx={x1} cy={y1} r={2.5} fill={LINE} />
      <circle cx={x2} cy={y2} r={2.5} fill={LINE} />
      <rect x={mx - label.length * 2.9} y={my - 8} width={label.length * 5.8} height={13} fill="#fff" opacity={0.92} />
      <text x={mx} y={my + 2} fontSize={9.5} textAnchor="middle" fill={MUTED}>
        {label}
      </text>
    </g>
  );
}

const ENTITY_COLORS: Record<"config" | "seed" | "runtime", string> = {
  config: NAVY,
  seed: BLUE,
  runtime: "#8a93a6",
};

function EntityBox({
  b,
  title,
  fields,
  variant,
}: {
  b: B;
  title: string;
  fields: string[];
  variant: "config" | "seed" | "runtime";
}) {
  const color = ENTITY_COLORS[variant];
  const dashed = variant === "runtime";
  return (
    <g>
      <rect
        x={b.x}
        y={b.y}
        width={b.w}
        height={b.h}
        rx={9}
        fill="#fff"
        stroke={dashed ? "#aab2c0" : "#d8dde6"}
        strokeWidth={1.2}
        strokeDasharray={dashed ? "5 4" : undefined}
      />
      <rect x={b.x} y={b.y} width={b.w} height={22} rx={9} fill={color} />
      <rect x={b.x} y={b.y + 11} width={b.w} height={11} fill={color} />
      <text x={b.x + 10} y={b.y + 15} fontSize={11.5} fontWeight={700} fill="#fff">
        {title}
      </text>
      {fields.map((f, i) => (
        <text key={i} x={b.x + 10} y={b.y + 36 + i * 14} fontSize={10.5} fill="#445">
          {f}
        </text>
      ))}
    </g>
  );
}

// ---------------------------------------------------------------------------
// 1) System overview
// ---------------------------------------------------------------------------
export function SystemDiagram() {
  const browser: B = { x: 290, y: 20, w: 320, h: 64 };
  const github: B = { x: 700, y: 20, w: 160, h: 50 };
  const apiRoutes: B = { x: 280, y: 150, w: 340, h: 78 };
  const ragCore: B = { x: 120, y: 280, w: 310, h: 90 };
  const ingestion: B = { x: 470, y: 280, w: 310, h: 90 };
  const openai: B = { x: 290, y: 430, w: 320, h: 76 };
  const M = "arrSys";

  return (
    <svg viewBox="0 0 900 522" width={900} height={522} role="img" aria-label="System architecture overview">
      <ArrowDefs id={M} />
      <rect x={90} y={104} width={720} height={280} rx={14} fill="none" stroke="#c7cede" strokeWidth={1.3} strokeDasharray="6 5" />
      <text x={104} y={124} fontSize={11.5} fontWeight={700} fill={NAVY}>
        Vercel — Node.js serverless functions (Fluid Compute)
      </text>

      <FlowBox b={browser} title="Browser" sub={["Next.js client components + React Context", "(Ask · Documents · Flags · Portfolio · Evals …)"]} accent="#556" />
      <FlowBox b={github} title="GitHub" sub={["git push → CI build"]} accent="#556" />
      <FlowBox b={apiRoutes} title="Next.js API routes" sub={["/api/query · /api/ingest · /api/portfolio", "/api/document · /api/config"]} />
      <FlowBox b={ragCore} title="RAG core — lib/rag.ts" sub={["Per-client VectorStoreIndex (LlamaIndex.TS)", "hybrid retrieve + rerank + guardrail"]} />
      <FlowBox b={ingestion} title="Ingestion — lib/ocr.ts + lib/analyze.ts" sub={["OCR: OpenAI Vision or Tesseract.js (local)", "PDF text-layer/rasterize · rule-based flags"]} />
      <FlowBox b={openai} title="OpenAI API (external)" dashed accent={NAVY} sub={["gpt-4o-mini — answers + vision OCR", "text-embedding-3-small — embeddings"]} />

      <Arrow x1={bottom(browser).x} y1={bottom(browser).y} x2={top(apiRoutes).x} y2={top(apiRoutes).y} markerId={M} label="HTTPS (fetch)" />
      <Arrow x1={bottom(github).x} y1={bottom(github).y} x2={780} y2={104} markerId={M} label="deploy" />
      <Arrow x1={280} y1={bottom(apiRoutes).y} x2={275} y2={top(ragCore).y} markerId={M} />
      <Arrow x1={550} y1={bottom(apiRoutes).y} x2={625} y2={top(ingestion).y} markerId={M} />
      <Arrow x1={left(ingestion).x} y1={left(ingestion).y} x2={right(ragCore).x} y2={right(ragCore).y} markerId={M} label="index.insert()" />
      <Arrow x1={275} y1={bottom(ragCore).y} x2={390} y2={top(openai).y} markerId={M} label="embed + generate" />
      <Arrow x1={625} y1={bottom(ingestion).y} x2={520} y2={top(openai).y} markerId={M} label="vision OCR" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// 2) Ask / query pipeline
// ---------------------------------------------------------------------------
export function PipelineDiagram() {
  const w = 165;
  const h = 90;
  const y = 50;
  const gap = 18;
  const xs = [15, 15 + (w + gap), 15 + 2 * (w + gap), 15 + 3 * (w + gap), 15 + 4 * (w + gap), 15 + 5 * (w + gap)];
  const boxes: B[] = xs.map((x) => ({ x, y, w, h }));
  const M = "arrPipe";
  const content: { title: string; sub: string[] }[] = [
    { title: "1 · Question", sub: ["User asks in", "plain English"] },
    { title: "2 · Embed query", sub: ["Question embedded alone —", "no system-prompt dilution"] },
    { title: "3 · Retrieve", sub: ["Top ~15 candidates", "(CANDIDATE_K), cosine sim."] },
    { title: "4 · Hybrid rerank", sub: ["+ keyword overlap →", "top 5 chunks (TOP_K)"] },
    { title: "5 · Guardrail", sub: ["best score < 0.28 →", "refuse before the LLM call"] },
    { title: "6 · Generate & cite", sub: ["gpt-4o-mini, temp 0 —", "or “Not found…”"] },
  ];

  return (
    <svg viewBox="0 0 1120 190" width={1120} height={190} role="img" aria-label="Ask query pipeline">
      <ArrowDefs id={M} />
      {boxes.map((b, i) => (
        <FlowBox key={i} b={b} title={content[i].title} sub={content[i].sub} accent={i === 4 ? "#a5670b" : BLUE} />
      ))}
      {boxes.slice(0, -1).map((b, i) => (
        <Arrow key={i} x1={right(b).x} y1={right(b).y} x2={left(boxes[i + 1]).x} y2={left(boxes[i + 1]).y} markerId={M} />
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// 3) Ingestion / OCR pipeline
// ---------------------------------------------------------------------------
export function IngestionDiagram() {
  const upload: B = { x: 360, y: 15, w: 200, h: 55 };
  const txt: B = { x: 20, y: 110, w: 230, h: 80 };
  const image: B = { x: 280, y: 110, w: 260, h: 80 };
  const pdf: B = { x: 570, y: 110, w: 260, h: 80 };
  const recognized: B = { x: 340, y: 225, w: 240, h: 55 };
  const flags: B = { x: 70, y: 320, w: 340, h: 70 };
  const insertIdx: B = { x: 460, y: 320, w: 340, h: 70 };
  const flagsDest: B = { x: 70, y: 415, w: 340, h: 50 };
  const insertDest: B = { x: 460, y: 415, w: 340, h: 50 };
  const M = "arrIngest";

  return (
    <svg viewBox="0 0 920 480" width={920} height={480} role="img" aria-label="Document ingestion and OCR pipeline">
      <ArrowDefs id={M} />
      <FlowBox b={upload} title="Upload" sub={["PDF / image / .txt", "≤ 15 MB"]} accent="#556" />
      <FlowBox b={txt} title=".txt / .md" sub={["Read directly —", "no OCR needed"]} />
      <FlowBox b={image} title="Image (PNG/JPG/WEBP)" sub={["OCR: OpenAI Vision (gpt-4o-mini)", "or Tesseract.js (local, on-prem)"]} />
      <FlowBox b={pdf} title="PDF" sub={["Text layer via unpdf; if < 200 chars,", "rasterize (pdf-to-img, ≤10 pg) + OCR"]} />
      <FlowBox b={recognized} title="Recognized text" accent="#556" />
      <FlowBox b={flags} title="Rule-based flags — lib/analyze.ts" sub={["auto-renew · change-of-control ·", "insurance · liability · governing law"]} accent="#a5670b" />
      <FlowBox b={insertIdx} title="Insert into live index — rag.ts" sub={["index.insert(Document)", "same in-memory index used by Ask"]} />
      <FlowBox b={flagsDest} title="Shown in Flags & Tasks" accent="#a5670b" />
      <FlowBox b={insertDest} title="Answerable immediately (Ask / Portfolio)" />

      <Arrow x1={bottom(upload).x} y1={bottom(upload).y} x2={top(txt).x} y2={top(txt).y} markerId={M} />
      <Arrow x1={bottom(upload).x} y1={bottom(upload).y} x2={top(image).x} y2={top(image).y} markerId={M} />
      <Arrow x1={bottom(upload).x} y1={bottom(upload).y} x2={top(pdf).x} y2={top(pdf).y} markerId={M} />

      <Arrow x1={bottom(txt).x} y1={bottom(txt).y} x2={left(recognized).x} y2={left(recognized).y} markerId={M} />
      <Arrow x1={bottom(image).x} y1={bottom(image).y} x2={top(recognized).x} y2={top(recognized).y} markerId={M} />
      <Arrow x1={bottom(pdf).x} y1={bottom(pdf).y} x2={right(recognized).x} y2={right(recognized).y} markerId={M} />

      <Arrow x1={bottom(recognized).x - 60} y1={bottom(recognized).y} x2={top(flags).x} y2={top(flags).y} markerId={M} />
      <Arrow x1={bottom(recognized).x + 60} y1={bottom(recognized).y} x2={top(insertIdx).x} y2={top(insertIdx).y} markerId={M} />

      <Arrow x1={bottom(flags).x} y1={bottom(flags).y} x2={top(flagsDest).x} y2={top(flagsDest).y} markerId={M} />
      <Arrow x1={bottom(insertIdx).x} y1={bottom(insertIdx).y} x2={top(insertDest).x} y2={top(insertDest).y} markerId={M} />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// 4) Multi-tenant isolation
// ---------------------------------------------------------------------------
export function IsolationDiagram() {
  const portfolio: B = { x: 270, y: 15, w: 360, h: 55 };
  const leftIdx: B = { x: 60, y: 110, w: 340, h: 150 };
  const rightIdx: B = { x: 500, y: 110, w: 340, h: 150 };
  const M = "arrIso";

  return (
    <svg viewBox="0 0 900 290" width={900} height={290} role="img" aria-label="Per-client index isolation">
      <ArrowDefs id={M} />
      <FlowBox b={portfolio} title="queryPortfolio(question) — Admin only" sub={["same pipeline, run once per client"]} accent="#556" />
      <FlowBox b={leftIdx} title="Northwind Logistics index" sub={["5 contracts (SEC EDGAR, public)", "Map key: 'northwind-logistics'", "", "Own Document nodes + embeddings"]} />
      <FlowBox b={rightIdx} title="Blue Harbor Retail index" sub={["3 contracts + 1 amendment (synthetic)", "Map key: 'blue-harbor-retail'", "", "Own Document nodes + embeddings"]} />

      <line x1={450} y1={110} x2={450} y2={260} stroke="#c7cede" strokeWidth={1.3} strokeDasharray="6 5" />
      <rect x={405} y={172} width={90} height={16} fill="#f6f7f9" />
      <text x={450} y={184} fontSize={10} textAnchor="middle" fill="#a3312d">
        no shared vectors
      </text>

      <Arrow x1={360} y1={bottom(portfolio).y} x2={230} y2={top(leftIdx).y} markerId={M} />
      <Arrow x1={540} y1={bottom(portfolio).y} x2={670} y2={top(rightIdx).y} markerId={M} />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// 5) ERD — logical data model
// ---------------------------------------------------------------------------
export function ErdDiagram() {
  const clientConfig: B = { x: 20, y: 20, w: 250, h: 110 };
  const clientSeed: B = { x: 295, y: 20, w: 250, h: 170 };
  const docMeta: B = { x: 570, y: 20, w: 250, h: 106 };
  const golden: B = { x: 845, y: 20, w: 250, h: 78 };

  const session: B = { x: 20, y: 230, w: 250, h: 64 };
  const auditEvent: B = { x: 295, y: 230, w: 250, h: 106 };
  const registerRow: B = { x: 570, y: 230, w: 250, h: 92 };
  const deadline: B = { x: 845, y: 230, w: 250, h: 78 };

  const flag: B = { x: 20, y: 360, w: 250, h: 106 };
  const taskItem: B = { x: 295, y: 360, w: 250, h: 134 };
  const queryResult: B = { x: 570, y: 360, w: 250, h: 106 };

  return (
    <svg viewBox="0 0 1140 500" width={1140} height={500} role="img" aria-label="Entity relationship diagram">
      <EntityBox b={clientConfig} variant="config" title="ClientConfig (server)" fields={["id", "name", "industry", "contractsDir", "extraDir"]} />
      <EntityBox b={clientSeed} variant="seed" title="ClientSeed (JSON, client-safe)" fields={["clientId", "client", "industry", "documents: DocMeta[]", "register: RegisterRow[]", "flags: Flag[]", "deadlines: Deadline[]", "presets: string[]", "goldens: Golden[]"]} />
      <EntityBox b={docMeta} variant="seed" title="DocMeta" fields={["file", "title", "type", "parties", "date", "law"]} />
      <EntityBox b={golden} variant="seed" title="Golden" fields={["q", "expected", "source"]} />

      <EntityBox b={session} variant="runtime" title="Session (runtime)" fields={["role", "name"]} />
      <EntityBox b={auditEvent} variant="runtime" title="AuditEvent (runtime)" fields={["time", "user", "role", "action", "detail"]} />
      <EntityBox b={registerRow} variant="seed" title="RegisterRow" fields={["doc", "term", "law", "parties", "key"]} />
      <EntityBox b={deadline} variant="seed" title="Deadline" fields={["date", "doc", "text"]} />

      <EntityBox b={flag} variant="seed" title="Flag" fields={["id", "level", "doc", "text", "cite"]} />
      <EntityBox b={taskItem} variant="runtime" title="TaskItem (runtime)" fields={["id", "clientId", "title", "source", "status", "createdAt", "docGenerated?"]} />
      <EntityBox b={queryResult} variant="runtime" title="QueryResult (runtime)" fields={["answer", "refused", "topScore", "sources: Source[]"]} />

      <RelLine x1={right(clientConfig).x} y1={right(clientConfig).y} x2={left(clientSeed).x} y2={left(clientSeed).y} label="1—1 (id = clientId)" />
      <RelLine x1={right(clientSeed).x} y1={right(clientSeed).y - 40} x2={left(docMeta).x} y2={left(docMeta).y} label="1—* documents[]" />
      <RelLine x1={right(clientSeed).x} y1={right(clientSeed).y - 90} x2={left(golden).x} y2={left(golden).y} label="1—* goldens[]" />
      <RelLine x1={bottom(clientSeed).x + 40} y1={bottom(clientSeed).y} x2={top(registerRow).x} y2={top(registerRow).y} label="1—* register[]" />
      <RelLine x1={bottom(clientSeed).x + 90} y1={bottom(clientSeed).y} x2={top(deadline).x} y2={top(deadline).y} label="1—* deadlines[]" />
      <RelLine x1={bottom(clientSeed).x - 40} y1={bottom(clientSeed).y} x2={top(flag).x} y2={top(flag).y} label="1—* flags[] (seed)" />
      <RelLine x1={right(flag).x} y1={right(flag).y} x2={left(taskItem).x} y2={left(taskItem).y} label="confirm → 0..1 task" />
      <RelLine x1={right(session).x} y1={right(session).y} x2={left(auditEvent).x} y2={left(auditEvent).y} label="1—* log()" />
      <RelLine x1={bottom(clientConfig).x} y1={bottom(clientConfig).y} x2={top(taskItem).x - 30} y2={top(taskItem).y} label="1—* (clientId)" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// 7) Real vs mock/seed proportion (stacked bar) — from README's status table
// ---------------------------------------------------------------------------
export function StatusChart({ real, mock, seed, mixed }: { real: number; mock: number; seed: number; mixed: number }) {
  const total = real + mock + seed + mixed;
  const barW = 600;
  const x0 = 40;
  const y = 25;
  const h = 30;
  const wReal = (real / total) * barW;
  const wMock = (mock / total) * barW;
  const wSeed = (seed / total) * barW;
  const wMixed = (mixed / total) * barW;
  const segs = [
    { w: wReal, color: "#185fa5" },
    { w: wMock, color: "#98a2b3" },
    { w: wSeed, color: "#a5670b" },
    { w: wMixed, color: "#6b4fa0" },
  ];
  let cursor = x0;
  return (
    <svg viewBox="0 0 680 80" width={680} height={80} role="img" aria-label="Share of real vs mock vs seed components">
      {segs.map((s, i) => {
        const rect = (
          <rect key={i} x={cursor} y={y} width={s.w} height={h} fill={s.color} />
        );
        cursor += s.w;
        return rect;
      })}
      <rect x={x0} y={y} width={barW} height={h} fill="none" stroke="#d8dde6" strokeWidth={1} />
    </svg>
  );
}
