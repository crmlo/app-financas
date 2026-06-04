import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { supabase } from "./lib/supabase";
import Auth from "./components/Auth";

// ─── Supabase data layer ──────────────────────────────────────────────────────
async function loadFromSupabase(familyId) {
  const { data, error } = await supabase
    .from("app_data")
    .select("data")
    .eq("family_id", familyId)
    .single();
  if (error) console.error("[loadFromSupabase] error:", error)
  return data?.data ?? null;
}

async function saveToSupabase(familyId, appData) {
  await supabase
    .from("app_data")
    .update({ data: appData, updated_at: new Date().toISOString() })
    .eq("family_id", familyId);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
const NOW = new Date();
const MS = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
const fmt  = (n) => (n ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtD = (n) => { const v = Math.abs(n ?? 0); return isFinite(v) ? `R$${Math.floor(v)}` : "R$0"; };
const fmtS = (n) => { const a = Math.abs(n ?? 0); if (!isFinite(a)) return "R$0"; return a >= 1000 ? `R$${(a/1000).toFixed(1)}k` : `R$${a.toFixed(0)}`; };

function getWorkday5(y, m) {
  let count = 0, day = 1;
  while (day <= 31) {
    const d = new Date(y, m, day);
    if (d.getMonth() !== m) break;
    if (d.getDay() !== 0 && d.getDay() !== 6) { count++; if (count === 5) return day; }
    day++;
  }
  return day - 1;
}

function getCycle(type, day) {
  const t = new Date(), td = t.getDate(), m = t.getMonth(), y = t.getFullYear();
  const lastDay = new Date(y, m + 1, 0).getDate();
  let sd;
  if (type === "calendar") sd = 1;
  else if (type === "workday5") sd = getWorkday5(y, m);
  else if (type === "closing") sd = day === "last" ? lastDay % lastDay + 1 : (parseInt(day) % lastDay) + 1;
  else sd = parseInt(day) || 1;
  let s, e;
  if (td >= sd) {
    s = new Date(y, m, sd);
    e = new Date(new Date(y, m + 1, sd) - 86400000);
  } else {
    s = new Date(y, m - 1, sd);
    e = new Date(y, m, sd - 1);
  }
  const total = Math.max(Math.round((e - s) / 86400000) + 1, 1);
  const cur   = Math.min(Math.round((t - s) / 86400000) + 1, total);
  return { s, e, total, cur };
}

const BLANK = {
  splash: false, onboarded: false,
  currentBalance: 0, income: 0,
  cycleType: "calendar", cycleDay: "1", cycleLast: false, primaryCard: "",
  cards: [], categories: [],
  monthlyInstallments: {},
  expenses: [],
  savings: false, savingsAmount: 0, savingsPct: false,
  freeMoney: [],
  members: [{ id: "master", name: "Eu", role: "master" }],
  familyCode: "",
  streak: 0,
};

// ─── Global Styles ────────────────────────────────────────────────────────────
function GS() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700;900&display=swap');
      *{box-sizing:border-box;margin:0;padding:0}
      body{background:#F5F4EF;font-family:'DM Sans',sans-serif}
      input,select,button{outline:none;-webkit-tap-highlight-color:transparent;font-family:'DM Sans',sans-serif}
      .inp{background:#F5F4EF;border:2px solid #E8E8E8;border-radius:12px;padding:13px 14px;color:#000;font-size:14px;font-weight:600;width:100%;transition:border-color .15s}
      .inp:focus{border-color:#FFD000;background:#fff}
      .inp::placeholder{color:#C0C0C0;font-weight:500}
      .sel{background:#F5F4EF;border:2px solid #E8E8E8;border-radius:12px;padding:13px 14px;color:#000;font-size:14px;font-weight:600;width:100%;cursor:pointer}
      .btn-y{background:#FFD000;color:#000;border:none;border-radius:12px;padding:15px 20px;font-size:14px;font-weight:900;cursor:pointer;width:100%;transition:opacity .15s}
      .btn-y:hover{opacity:.85}
      .btn-y:disabled{opacity:.4;cursor:not-allowed}
      .btn-out{background:transparent;color:#000;border:2px solid #E8E8E8;border-radius:12px;padding:13px 16px;font-size:13px;font-weight:700;cursor:pointer}
      .seg{display:flex;border:2px solid #E8E8E8;border-radius:12px;overflow:hidden;background:#F5F4EF}
      .sb{flex:1;background:transparent;border:none;color:#999;font-size:12px;font-weight:700;padding:11px 6px;cursor:pointer;transition:all .15s}
      .sb.on{background:#000;color:#FFD000}
      .sb:disabled{opacity:.4;cursor:not-allowed}
      .tog{width:46px;height:26px;background:#E0E0E0;border-radius:13px;border:none;cursor:pointer;position:relative;transition:background .2s;flex-shrink:0}
      .tog.on{background:#FFD000}
      .tog::after{content:'';position:absolute;width:20px;height:20px;background:#fff;border-radius:50%;top:3px;left:3px;transition:transform .2s;box-shadow:0 1px 4px rgba(0,0,0,.2)}
      .tog.on::after{transform:translateX(20px)}
      @keyframes slideUp{from{transform:translateY(40px);opacity:0}to{transform:translateY(0);opacity:1}}
    `}</style>
  );
}

function Mdl({ title, onClose, children }) {
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.5)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:100,backdropFilter:"blur(4px)"}} onClick={onClose}>
      <div style={{background:"#fff",borderRadius:"20px 20px 0 0",padding:24,width:"100%",maxWidth:480,animation:"slideUp .25s ease",maxHeight:"92vh",overflowY:"auto"}} onClick={e => e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
          <div style={{fontSize:18,fontWeight:900}}>{title}</div>
          <button onClick={onClose} style={{background:"#F5F4EF",border:"none",borderRadius:"50%",width:32,height:32,cursor:"pointer",fontSize:16,fontWeight:700}}>✕</button>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:12}}>{children}</div>
      </div>
    </div>
  );
}

function Splash({ onStart }) {
  return (
    <div style={{minHeight:"100vh",background:"#FFD000",display:"flex",flexDirection:"column",justifyContent:"space-between",padding:"60px 28px 48px"}}>
      <GS />
      <div>
        <div style={{fontSize:11,fontWeight:900,letterSpacing:3,color:"rgba(0,0,0,.35)",textTransform:"uppercase",marginBottom:20}}>Uma nova forma de organizar</div>
        <div style={{fontSize:42,fontWeight:900,color:"#000",lineHeight:1.1,marginBottom:24}}>Controle financeiro do jeito que funciona 💛</div>
        <p style={{fontSize:16,color:"rgba(0,0,0,.55)",lineHeight:1.7,marginBottom:8}}>Sem categorizar cada gasto. Sem planilha. Sem burocracia.</p>
        <p style={{fontSize:16,fontWeight:700,color:"#000",lineHeight:1.5}}>Só um número todo dia: quanto você pode gastar hoje.</p>
        <div style={{marginTop:32,display:"flex",flexDirection:"column",gap:10}}>
          {["🎯 Limite diário que se redistribui sozinho","🔮 Veja o impacto de cada parcela no futuro","👫 Controle compartilhado com a família","⚡ Configure em 5 minutos"].map(t => (
            <div key={t} style={{background:"rgba(0,0,0,.08)",borderRadius:12,padding:"11px 14px",fontSize:14,fontWeight:500}}>{t}</div>
          ))}
        </div>
      </div>
      <button onClick={onStart} style={{background:"#000",color:"#FFD000",border:"none",borderRadius:16,padding:18,fontSize:16,fontWeight:900,cursor:"pointer",marginTop:32}}>Começar agora →</button>
    </div>
  );
}

function Onboarding({ data, setData }) {
  const STEPS = ["Saldo atual","Renda","Meu ciclo financeiro","Meus cartões de crédito","Minhas despesas","Parcelas","Dinheiro livre","Poupança","Revisão 🎉"];
  const [step, setStep]               = useState(0);
  const [balance, setBalance]         = useState("");
  const [income, setIncome]           = useState("");
  const [cycleType, setCycleType]     = useState("calendar");
  const [cycleDay, setCycleDay]       = useState("1");
  const [cycleLast, setCycleLast]     = useState(false);
  const [cards, setCards]             = useState([]);
  const [primaryCard, setPrimaryCard] = useState("");
  const [cf, setCf] = useState({ name:"", closingDay:"", closingLast:false, dueDay:"", dueDayType:"fixed" });
  const [cats, setCats]     = useState([]);
  const [cat, setCat]       = useState({ name:"", type:"variable", amount:"", paymentType:"debit", cardId:"" });
  const [monthInst, setMonthInst]     = useState({});
  const [editingMonth, setEditingMonth] = useState(null);
  const [editingVal, setEditingVal]   = useState("");
  const [freeList, setFreeList]       = useState([]);
  const [freeF, setFreeF]             = useState({ name:"", amount:"" });
  const [savings, setSavings]         = useState(false);
  const [savAmt, setSavAmt]           = useState("");
  const [savPct, setSavPct]           = useState(false);

  const inc    = parseFloat(income) || 0;
  const tFixed = cats.filter(c => c.type === "fixed").reduce((s,c) => s + parseFloat(c.amount), 0);
  const tVar   = cats.filter(c => c.type === "variable").reduce((s,c) => s + parseFloat(c.amount), 0);
  const tFree  = freeList.reduce((s,f) => s + f.amount, 0);
  const savA   = savings ? (savPct ? inc * (parseFloat(savAmt) || 0) / 100 : (parseFloat(savAmt) || 0)) : 0;
  const curInstKey = `${NOW.getFullYear()}-${NOW.getMonth()}`;
  const tInst  = parseFloat(monthInst[curInstKey]) || 0;
  const saldo  = inc - tFixed - tVar - tInst - savA - tFree;

  const futureMonthKeys = useMemo(() => {
    const keys = [];
    for (let i = 0; i < 61; i++) {
      const m = (NOW.getMonth() + i) % 12;
      const y = NOW.getFullYear() + Math.floor((NOW.getMonth() + i) / 12);
      keys.push({ key: `${y}-${m}`, label: MS[m], year: y, month: m });
    }
    return keys;
  }, []);

  const yearGroups = useMemo(() => {
    const groups = {};
    futureMonthKeys.forEach(k => {
      if (!groups[k.year]) groups[k.year] = [];
      groups[k.year].push(k);
    });
    return Object.entries(groups).map(([year, months]) => ({ year: parseInt(year), months }));
  }, [futureMonthKeys]);

  const canNext = [!!balance, !!income, true, true, cats.length > 0, true, true, true, true];

  const addCard = () => {
    if (!cf.name || (!cf.closingLast && !cf.closingDay) || !cf.dueDay) return;
    const card = { ...cf, closingDay: cf.closingLast ? "last" : cf.closingDay, id: Date.now() };
    const updated = [...cards, card];
    setCards(updated);
    if (updated.length === 1) setPrimaryCard(String(card.id));
    setCf({ name:"", closingDay:"", closingLast:false, dueDay:"", dueDayType:"fixed" });
  };

  const addCat = () => {
    if (!cat.name || !cat.amount) return;
    setCats(cs => [...cs, { ...cat, id: Date.now(), amount: parseFloat(cat.amount) }]);
    setCat({ name:"", type:"variable", amount:"", paymentType:"debit", cardId:"" });
  };

  const saveMonth = () => {
    if (editingMonth === null) return;
    const val = parseFloat(editingVal) || 0;
    if (val > 0) {
      setMonthInst(m => ({ ...m, [editingMonth]: val }));
    } else {
      setMonthInst(m => { const n = { ...m }; delete n[editingMonth]; return n; });
    }
    setEditingMonth(null);
    setEditingVal("");
  };

  const addFree = () => {
    if (!freeF.name || !freeF.amount) return;
    setFreeList(fs => [...fs, { ...freeF, memberId: freeF.name.toLowerCase().replace(/\s/g, "_"), amount: parseFloat(freeF.amount) }]);
    setFreeF({ name:"", amount:"" });
  };

  const finish = () => {
    const finalCycleDay = cycleType === "closing" ? (cycleLast ? "last" : cycleDay) : cycleDay;
    const instMap = {};
    Object.entries(monthInst).forEach(([k, v]) => { if (v) instMap[k] = parseFloat(v); });
    setData({
      ...data, onboarded: true,
      currentBalance: parseFloat(balance) || 0,
      income: inc, cycleType, cycleDay: finalCycleDay, cycleLast, primaryCard,
      cards, categories: cats,
      monthlyInstallments: instMap,
      freeMoney: freeList,
      savings, savingsAmount: parseFloat(savAmt) || 0, savingsPct: savPct,
      members: [{ id: "master", name: "Eu", role: "master" }],
    });
  };

  const reviewItems = [
    { label: "💰 Saldo atual", value: fmt(parseFloat(balance)||0), step: 0 },
    { label: "💵 Renda mensal", value: fmt(inc), step: 1 },
    { label: "📅 Ciclo", value: cycleType==="calendar"?"Dia 1":cycleType==="workday5"?"5º dia útil":cycleType==="closing"?`Fecha ${cycleLast?"último dia":cycleDay}`:`Dia ${cycleDay}`, step: 2 },
    { label: "🔒 Fixos", value: fmt(tFixed), step: 4 },
    { label: "💛 Variáveis", value: fmt(tVar), step: 4 },
    { label: "📦 Parcelas (mês atual)", value: fmt(tInst), step: 5 },
    tFree > 0 ? { label: "🆓 Dinheiro livre", value: fmt(tFree), step: 6 } : null,
    savings ? { label: "🏦 Poupança", value: savPct ? `${savAmt}% = ${fmt(savA)}` : fmt(savA), step: 7 } : null,
    { label: "✨ Saldo livre mensal", value: fmt(saldo), step: 4, highlight: saldo < 0 ? "#E85D4A" : "#166534" },
  ].filter(Boolean);

  return (
    <div style={{minHeight:"100vh",background:"#F5F4EF",display:"flex",flexDirection:"column"}}>
      <GS />
      <div style={{background:"#FFD000",padding:"20px 20px 18px"}}>
        <div style={{display:"flex",gap:4,marginBottom:12}}>
          {STEPS.map((_,i) => <div key={i} style={{flex:1,height:4,borderRadius:2,background:i<=step?"#000":"rgba(0,0,0,.15)",transition:"background .3s"}} />)}
        </div>
        <div style={{fontSize:10,fontWeight:700,letterSpacing:2,color:"rgba(0,0,0,.4)",textTransform:"uppercase"}}>{step+1} de {STEPS.length}</div>
        <div style={{fontSize:26,fontWeight:900,color:"#000",marginTop:4,lineHeight:1.1}}>{STEPS[step]}</div>
      </div>

      <div style={{flex:1,padding:20,display:"flex",flexDirection:"column",gap:12,overflowY:"auto"}}>
        {step === 0 && <>
          <p style={{fontSize:14,color:"#666",lineHeight:1.7}}>Quanto você tem disponível na conta hoje?</p>
          <CurrencyInput value={balance} onChange={setBalance} placeholder="0,00" />
          <div style={{fontSize:12,color:"#999",background:"#fff",borderRadius:10,padding:"10px 12px",lineHeight:1.6}}>💡 Não precisa ser exato. O app vai projetar como esse saldo evolui mês a mês.</div>
        </>}

        {step === 1 && <>
          <p style={{fontSize:14,color:"#666",lineHeight:1.7}}>Some todas as entradas mensais da família.</p>
          <CurrencyInput value={income} onChange={setIncome} placeholder="0,00" />
        </>}

        {step === 2 && <>
          <p style={{fontSize:14,color:"#666",lineHeight:1.7}}>Quando seu mês financeiro começa?</p>
          {[
            ["calendar","📅","Dia 1 — mês calendário","Começa sempre no dia 1"],
            ["workday5","💰","Quinto dia útil","O app calcula automaticamente para cada mês"],
            ["closing","💳","Fechamento da minha fatura","Considere o fechamento do seu cartão principal"],
            ["custom","📆","Outro dia específico","Você escolhe o dia"],
          ].map(([v,ic,lb,sub]) => (
            <button key={v} onClick={() => setCycleType(v)} style={{background:cycleType===v?"#000":"#fff",border:`2px solid ${cycleType===v?"#000":"#E8E8E8"}`,borderRadius:14,padding:"14px 16px",textAlign:"left",cursor:"pointer"}}>
              <div style={{fontSize:14,fontWeight:700,color:cycleType===v?"#FFD000":"#000"}}>{ic} {lb}</div>
              <div style={{fontSize:11,color:cycleType===v?"rgba(255,208,0,.6)":"#999",marginTop:3}}>{sub}</div>
            </button>
          ))}
          {cycleType === "closing" && <>
            <div style={{fontSize:12,fontWeight:700,color:"#666"}}>Qual dia a fatura fecha?</div>
            <div style={{display:"flex",gap:8}}>
              <input className="inp" type="number" placeholder="Dia (1-28)" value={cycleLast?"":cycleDay} onChange={e => setCycleDay(e.target.value)} style={{flex:1}} disabled={cycleLast} />
              <button onClick={() => setCycleLast(v => !v)} style={{background:cycleLast?"#000":"#F5F4EF",color:cycleLast?"#FFD000":"#666",border:"2px solid #E8E8E8",borderRadius:12,padding:"0 12px",fontSize:12,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>Último dia do mês</button>
            </div>
          </>}
          {cycleType === "custom" && <input className="inp" type="number" min="1" max="28" placeholder="Dia de início (1-28)" value={cycleDay} onChange={e => setCycleDay(e.target.value)} />}
        </>}

        {step === 3 && <>
          <p style={{fontSize:14,color:"#666",lineHeight:1.7}}>Cadastre seus cartões para o app saber em qual mês cada compra será cobrada.</p>
          <div style={{background:"#fff",borderRadius:16,padding:16,border:"1px solid #E8E8E8",display:"flex",flexDirection:"column",gap:10}}>
            <input className="inp" placeholder="Nome (ex: Nubank, C6)" value={cf.name} onChange={e => setCf(f => ({ ...f, name: e.target.value }))} />
            <div style={{fontSize:12,fontWeight:700,color:"#666"}}>Qual dia a fatura fecha?</div>
            <div style={{display:"flex",gap:8}}>
              <input className="inp" type="number" placeholder="Dia (1-28)" value={cf.closingLast?"":cf.closingDay} onChange={e => setCf(f => ({ ...f, closingDay: e.target.value }))} style={{flex:1}} disabled={cf.closingLast} />
              <button onClick={() => setCf(f => ({ ...f, closingLast:!f.closingLast, closingDay:"" }))} style={{background:cf.closingLast?"#000":"#F5F4EF",color:cf.closingLast?"#FFD000":"#666",border:"2px solid #E8E8E8",borderRadius:12,padding:"0 12px",fontSize:12,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>Último dia do mês</button>
            </div>
            <div style={{fontSize:12,fontWeight:700,color:"#666"}}>Quando você paga?</div>
            <div className="seg">
              <button className={"sb"+(cf.dueDayType==="fixed"?" on":"")} onClick={() => setCf(f => ({ ...f, dueDayType:"fixed" }))}>Dia fixo</button>
              <button className={"sb"+(cf.dueDayType==="after"?" on":"")} onClick={() => setCf(f => ({ ...f, dueDayType:"after" }))}>X dias após fechamento</button>
            </div>
            <input className="inp" type="number" placeholder={cf.dueDayType==="fixed"?"Dia do vencimento":"Quantos dias após?"} value={cf.dueDay} onChange={e => setCf(f => ({ ...f, dueDay: e.target.value }))} />
            <button className="btn-y" onClick={addCard}>+ Adicionar cartão</button>
          </div>
          {cards.map(c => (
            <div key={c.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:"#fff",borderRadius:12,padding:"12px 14px",border:"1px solid #E8E8E8"}}>
              <div>
                <div style={{fontSize:14,fontWeight:700}}>💳 {c.name}</div>
                <div style={{fontSize:11,color:"#bbb",marginTop:2}}>Fecha: {c.closingDay==="last"?"último dia":"dia "+c.closingDay} · Vence: {c.dueDayType==="after"?c.dueDay+"d após":"dia "+c.dueDay}</div>
              </div>
              <button onClick={() => setCards(cs => cs.filter(x => x.id !== c.id))} style={{background:"none",border:"none",color:"#E85D4A",cursor:"pointer",fontSize:18}}>✕</button>
            </div>
          ))}
          {cards.length > 1 && <>
            <div style={{fontSize:12,fontWeight:700,color:"#666"}}>Qual é seu cartão principal?</div>
            <select className="sel" value={primaryCard} onChange={e => setPrimaryCard(e.target.value)}>
              {cards.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </>}
          <div style={{fontSize:12,color:"#bbb",textAlign:"center"}}>Sem cartão? Pode pular ↓</div>
        </>}

        {step === 4 && <>
          <p style={{fontSize:14,color:"#666",lineHeight:1.7}}>Cadastre suas despesas mensais.</p>
          {inc > 0 && (
            <div style={{background:saldo<0?"#FEF2F2":"#000",borderRadius:12,padding:"12px 14px",display:"flex",justifyContent:"space-between"}}>
              <span style={{fontSize:13,color:saldo<0?"#E85D4A":"rgba(255,255,255,.5)"}}>Saldo livre mensal</span>
              <span style={{fontSize:14,fontWeight:900,color:saldo<0?"#E85D4A":"#FFD000"}}>{fmt(saldo)}</span>
            </div>
          )}
          <div style={{background:"#fff",borderRadius:16,padding:16,border:"1px solid #E8E8E8",display:"flex",flexDirection:"column",gap:10}}>
            <input className="inp" placeholder="Nome (ex: Mercado, Netflix, Pet...)" value={cat.name} onChange={e => setCat(f => ({ ...f, name: e.target.value }))} />
            <input className="inp" type="number" placeholder="Valor mensal (R$)" value={cat.amount} onChange={e => setCat(f => ({ ...f, amount: e.target.value }))} />
            <div className="seg">
              <button className={"sb"+(cat.type==="variable"?" on":"")} onClick={() => setCat(f => ({ ...f, type:"variable" }))}>💛 Variável</button>
              <button className={"sb"+(cat.type==="fixed"?" on":"")} onClick={() => setCat(f => ({ ...f, type:"fixed" }))}>🔒 Fixo</button>
            </div>
            <div className="seg">
              <button className={"sb"+(cat.paymentType==="debit"?" on":"")} onClick={() => setCat(f => ({ ...f, paymentType:"debit" }))}>Débito/Pix/Dinheiro</button>
              <button className={"sb"+(cat.paymentType==="credit"?" on":"")} onClick={() => setCat(f => ({ ...f, paymentType:"credit" }))}>Crédito</button>
            </div>
            {cat.paymentType==="credit" && cards.length > 0 && (
              <select className="sel" value={cat.cardId} onChange={e => setCat(f => ({ ...f, cardId: e.target.value }))}>
                <option value="">Selecionar cartão</option>
                {cards.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
            <button className="btn-y" onClick={addCat}>✓ Adicionar despesa</button>
          </div>
          {cats.map(c => (
            <div key={c.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:"#fff",borderRadius:12,padding:"12px 14px",border:"1px solid #E8E8E8"}}>
              <div>
                <span style={{fontSize:14,fontWeight:600}}>{c.name}</span>
                <span style={{fontSize:11,fontWeight:700,color:c.type==="variable"?"#b8860b":"#666",background:c.type==="variable"?"#FFF9E6":"#F5F4EF",padding:"2px 8px",borderRadius:20,marginLeft:8}}>{c.type==="variable"?"variável":"fixo"}</span>
              </div>
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                <span style={{fontSize:13,fontWeight:700}}>{fmt(c.amount)}</span>
                <button onClick={() => setCats(cs => cs.filter(x => x.id !== c.id))} style={{background:"none",border:"none",color:"#E85D4A",cursor:"pointer",fontSize:16}}>✕</button>
              </div>
            </div>
          ))}
        </>}

        {step === 5 && <>
          <div style={{background:"#FFF9E6",borderRadius:12,padding:"12px 14px",border:"1px solid #FFD000"}}>
            <div style={{fontSize:13,fontWeight:700,color:"#b8860b",marginBottom:6}}>💡 Como funciona</div>
            <p style={{fontSize:12,color:"#b8860b",lineHeight:1.6}}>Toque em cada mês e informe o <strong>total de parcelas</strong> que saem naquele mês.</p>
          </div>
          {yearGroups.map(({ year, months }) => (
            <div key={year}>
              <div style={{fontSize:13,fontWeight:900,marginBottom:8,marginTop:4}}>{year}</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8}}>
                {months.map(({ key, label }) => {
                  const val = monthInst[key];
                  const hasVal = val && parseFloat(val) > 0;
                  return (
                    <button key={key} onClick={() => { setEditingMonth(key); setEditingVal(val ? String(val) : ""); }} style={{background:hasVal?"#000":"#fff",border:`2px solid ${hasVal?"#000":"#E8E8E8"}`,borderRadius:12,padding:"10px 8px",cursor:"pointer",textAlign:"center"}}>
                      <div style={{fontSize:12,fontWeight:700,color:hasVal?"#FFD000":"#666"}}>{label}</div>
                      {hasVal ? <div style={{fontSize:10,color:"rgba(255,208,0,.7)",marginTop:2}}>{fmtS(parseFloat(val))}</div> : <div style={{fontSize:10,color:"#ccc",marginTop:2}}>—</div>}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {editingMonth !== null && (
            <Mdl title={`Parcelas — ${MS[parseInt(editingMonth.split("-")[1])]} ${editingMonth.split("-")[0]}`} onClose={() => setEditingMonth(null)}>
              <input className="inp" type="number" placeholder="R$ 0,00" style={{fontSize:24,fontWeight:900,textAlign:"center"}} value={editingVal} onChange={e => setEditingVal(e.target.value)} autoFocus />
              <button className="btn-y" onClick={saveMonth}>Adicionar total de parcelas</button>
            </Mdl>
          )}
          <div style={{fontSize:12,color:"#bbb",textAlign:"center"}}>Sem parcelas? Pode pular ↓</div>
        </>}

        {step === 6 && <>
          <p style={{fontSize:14,color:"#666",lineHeight:1.7}}>Dinheiro livre é uma quantia individual, sem justificativa.</p>
          <div style={{background:"#fff",borderRadius:16,padding:16,border:"1px solid #E8E8E8",display:"flex",flexDirection:"column",gap:10}}>
            <input className="inp" placeholder="Nome da pessoa (ex: Karyn)" value={freeF.name} onChange={e => setFreeF(f => ({ ...f, name: e.target.value }))} />
            <input className="inp" type="number" placeholder="Valor mensal (R$)" value={freeF.amount} onChange={e => setFreeF(f => ({ ...f, amount: e.target.value }))} />
            <button className="btn-y" onClick={addFree}>+ Adicionar</button>
          </div>
          {freeList.map((f, i) => (
            <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:"#fff",borderRadius:12,padding:"12px 14px",border:"1px solid #E8E8E8"}}>
              <span style={{fontSize:14,fontWeight:700}}>💛 {f.name}</span>
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                <span style={{fontSize:13,fontWeight:700}}>{fmt(f.amount)}/mês</span>
                <button onClick={() => setFreeList(fs => fs.filter((_,j) => j !== i))} style={{background:"none",border:"none",color:"#E85D4A",cursor:"pointer",fontSize:16}}>✕</button>
              </div>
            </div>
          ))}
          <div style={{fontSize:12,color:"#bbb",textAlign:"center"}}>Sem dinheiro livre? Pode pular ↓</div>
        </>}

        {step === 7 && <>
          <p style={{fontSize:14,color:"#666",lineHeight:1.7}}>A poupança é reservada <strong style={{color:"#000"}}>antes de qualquer gasto</strong>.</p>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:16,background:"#fff",border:"1px solid #E8E8E8",borderRadius:14}}>
            <span style={{fontSize:15,fontWeight:700}}>💰 Quero poupar todo mês</span>
            <button className={"tog"+(savings?" on":"")} onClick={() => setSavings(v => !v)} />
          </div>
          {savings && <>
            <div className="seg">
              <button className={"sb"+(!savPct?" on":"")} onClick={() => setSavPct(false)}>Valor fixo (R$)</button>
              <button className={"sb"+(savPct?" on":"")} onClick={() => setSavPct(true)}>% da renda</button>
            </div>
            <input className="inp" type="number" placeholder={savPct?"% da renda (ex: 10)":"Valor mensal (R$)"} value={savAmt} onChange={e => setSavAmt(e.target.value)} />
          </>}
        </>}

        {step === 8 && <>
          <p style={{fontSize:14,color:"#666",lineHeight:1.6}}>Toque em qualquer item para editar antes de começar.</p>
          {reviewItems.map((item, i) => (
            <button key={i} onClick={() => setStep(item.step)} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"14px 16px",background:"#fff",borderRadius:12,border:"1px solid #E8E8E8",cursor:"pointer",width:"100%",textAlign:"left"}}>
              <span style={{fontSize:13,color:"#666"}}>{item.label}</span>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:13,fontWeight:900,color:item.highlight||"#000"}}>{item.value}</span>
                <span style={{fontSize:11,color:"#bbb"}}>✎</span>
              </div>
            </button>
          ))}
        </>}

        <div style={{display:"flex",gap:10,marginTop:4}}>
          {step > 0 && <button className="btn-out" style={{flex:1}} onClick={() => setStep(s => s-1)}>← Voltar</button>}
          {step < STEPS.length-1
            ? <button className="btn-y" style={{flex:2,opacity:canNext[step]?1:.4}} onClick={() => canNext[step] && setStep(s => s+1)}>Continuar →</button>
            : <button className="btn-y" style={{flex:2}} onClick={finish}>Começar a usar! →</button>
          }
        </div>
        {[3,5,6].includes(step) && (
          <button style={{background:"none",border:"none",color:"#bbb",fontSize:13,cursor:"pointer",textAlign:"center",width:"100%",padding:"4px"}} onClick={() => setStep(s => s+1)}>Pular por agora</button>
        )}
      </div>
    </div>
  );
}

// ─── App Shell ────────────────────────────────────────────────────────────────
export default function App() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [authChecked, setAuthChecked] = useState(false)
  const [data, setDataState] = useState(null)
  const [syncing, setSyncing] = useState(false)
  const saveTimerRef = useRef(null)
  const familyIdRef = useRef(null)

  // Check auth on mount and listen for changes
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session: s } }) => {
      console.log("[auth] getSession →", s ? `user=${s.user.id}` : "no session")
      setSession(s)
      if (s) {
        const { data: prof, error: profErr } = await supabase
          .from("profiles")
          .select("*, families(*)")
          .eq("id", s.user.id)
          .single()
        console.log("[auth] profile →", prof, profErr)
        setProfile(prof)
        if (prof?.family_id) {
          familyIdRef.current = prof.family_id
          const appData = await loadFromSupabase(prof.family_id)
          console.log("[auth] app_data →", appData)
          setDataState(appData ?? { ...BLANK, familyCode: prof.families?.invite_code ?? "" })
        } else {
          console.warn("[auth] profile has no family_id — staying on auth screen")
        }
      }
      setAuthChecked(true)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      console.log("[auth] onAuthStateChange →", event, s ? s.user.id : null)
      // Only clear state on sign-out. Do NOT set session on SIGNED_IN here —
      // handleAuth (called by the Auth component after full setup) is responsible
      // for setting session+profile+data atomically to avoid a loading deadlock.
      if (!s) {
        setSession(null)
        setProfile(null)
        setDataState(null)
        familyIdRef.current = null
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  // Realtime subscription: receive updates from other family members
  useEffect(() => {
    if (!profile?.family_id) return
    const channel = supabase
      .channel(`family-${profile.family_id}`)
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "app_data",
        filter: `family_id=eq.${profile.family_id}`,
      }, (payload) => {
        // Only update if the change came from another device
        // (debounce guard: if we just saved, ignore)
        if (payload.new?.data) {
          setDataState(payload.new.data)
        }
      })
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [profile?.family_id])

  // Debounced save to Supabase whenever data changes
  const setData = useCallback((newData) => {
    const resolved = typeof newData === "function" ? newData(data) : newData
    setDataState(resolved)
    if (!familyIdRef.current) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      setSyncing(true)
      await saveToSupabase(familyIdRef.current, resolved)
      setSyncing(false)
    }, 800)
  }, [data])

  const upd = useCallback((fn) => setData(d => fn({ ...d })), [setData])

  const handleAuth = async (user, prof) => {
    console.log("[handleAuth] user=", user.id, "family_id=", prof?.family_id)
    setSession({ user })
    setProfile(prof)
    familyIdRef.current = prof.family_id
    const appData = await loadFromSupabase(prof.family_id)
    console.log("[handleAuth] app_data →", appData)
    setDataState(appData ?? { ...BLANK, familyCode: prof.families?.invite_code ?? "" })
    setAuthChecked(true)
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    setSession(null)
    setProfile(null)
    setDataState(null)
    familyIdRef.current = null
  }

  if (!authChecked) {
    return (
      <div style={{ minHeight: "100vh", background: "#FFD000", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <GS />
        <div style={{ fontSize: 28, fontWeight: 900 }}>💛</div>
      </div>
    )
  }

  if (!session) return <Auth onAuth={handleAuth} />

  if (!data) {
    return (
      <div style={{ minHeight: "100vh", background: "#F5F4EF", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <GS />
        <div style={{ fontSize: 14, color: "#999" }}>Carregando...</div>
      </div>
    )
  }

  if (!data.splash) return <Splash onStart={() => setData({ ...data, splash: true })} />
  if (!data.onboarded) return <Onboarding data={data} setData={setData} />
  return <MainApp data={data} upd={upd} syncing={syncing} profile={profile} onLogout={handleLogout} />
}

// ─── Main App ─────────────────────────────────────────────────────────────────
function MainApp({ data, upd, syncing, profile, onLogout }) {
  const [view, setView]               = useState("today");
  const [profileOpen, setProfileOpen] = useState(false);

  const cy         = getCycle(data.cycleType, data.cycleDay);
  const categories = data.categories || [];
  const freeMoney  = data.freeMoney  || [];
  const instMap    = data.monthlyInstallments || {};
  const tFixed    = categories.filter(c => c.type==="fixed").reduce((s,c) => s+c.amount, 0);
  const tVar      = categories.filter(c => c.type==="variable").reduce((s,c) => s+c.amount, 0);
  const curKey    = `${NOW.getFullYear()}-${NOW.getMonth()}`;
  const tInst     = instMap[curKey] || 0;
  const savAmt    = data.savings ? (data.savingsPct ? data.income*data.savingsAmount/100 : data.savingsAmount) : 0;
  const tFree     = freeMoney.reduce((s,f) => s+f.amount, 0);
  const freeSaldo = data.income - tFixed - tInst - tVar - savAmt - tFree;
  const dailyBase = cy.total > 0 && tVar > 0 ? tVar / cy.total : 0;

  const cyExp = useMemo(() => (data.expenses||[]).filter(e => {
    const d = new Date(e.date+"T12:00:00");
    return d >= cy.s && d <= cy.e;
  }), [data.expenses, cy]);

  const dmap = useMemo(() => {
    const m = {};
    cyExp.filter(e => e.pool==="family").forEach(e => {
      const k = Math.max(Math.floor((new Date(e.date+"T12:00:00")-cy.s)/86400000)+1, 1);
      m[k] = (m[k]||0) + (e.isRefund || e.isIncome ? -e.amount : e.amount);
    });
    return m;
  }, [cyExp, cy]);

  const { da, rem } = useMemo(() => {
    const a = {}; let carry = 0;
    for (let d = 1; d <= cy.total; d++) {
      const base = dailyBase+carry, sp = dmap[d]||0;
      if (d < cy.cur)      { const diff=base-sp; carry=(cy.total-d)>0?diff/(cy.total-d):0; a[d]={al:base,sp,diff}; }
      else if (d===cy.cur) a[d] = {al:base,sp,diff:base-sp};
      else                 a[d] = {al:base,sp:0,diff:0};
    }
    return { da:a, rem:a[cy.cur]?.diff??dailyBase };
  }, [dailyBase, dmap, cy]);

  const tSpent    = cyExp.filter(e => e.pool==="family"&&!e.isRefund&&!e.isIncome).reduce((s,e) => s+e.amount, 0);
  const freeSpent = useMemo(() => { const m={}; cyExp.filter(e=>e.pool==="free").forEach(e=>{m[e.memberId]=(m[e.memberId]||0)+e.amount;}); return m; }, [cyExp]);
  const over      = rem < 0;

  const futureMonths = useMemo(() => {
    let runBal = data.currentBalance;
    return Array.from({length:24}, (_,i) => {
      const rm=(NOW.getMonth()+i)%12, ry=NOW.getFullYear()+Math.floor((NOW.getMonth()+i)/12);
      const days=new Date(ry,rm+1,0).getDate();
      const mKey=`${ry}-${rm}`;
      const instAmt=instMap[mKey]||0;
      const varActual=i===0?tSpent:tVar;
      const monthlyResult=data.income-tFixed-instAmt-varActual-savAmt-tFree;
      runBal+=monthlyResult;
      const fs=data.income-tFixed-instAmt-tVar-savAmt-tFree;
      return {label:MS[rm],year:ry,inst:instAmt,variable:tVar,freeSaldo:fs,daily:tVar/days,days,isRed:runBal<0,balance:runBal,monthlyResult};
    });
  }, [data, tFixed, tVar, savAmt, tFree, tSpent]);

  const addExp   = (e) => upd(d => ({ ...d, expenses:[...d.expenses,{...e,id:Date.now()}] }));
  const delExp   = (id) => upd(d => ({ ...d, expenses:d.expenses.filter(e=>e.id!==id) }));
  const saveCat  = (cat,eid) => { if(eid) upd(d=>({...d,categories:d.categories.map(c=>c.id===eid?{...c,...cat,amount:parseFloat(cat.amount)}:c)})); else upd(d=>({...d,categories:[...d.categories,{...cat,id:Date.now(),amount:parseFloat(cat.amount)}]})); };
  const delCat   = (id) => upd(d => ({ ...d, categories:d.categories.filter(c=>c.id!==id) }));
  const saveCard = (card,eid) => { if(eid) upd(d=>({...d,cards:d.cards.map(c=>c.id===eid?{...c,...card}:c)})); else upd(d=>({...d,cards:[...d.cards,{...card,id:Date.now()}]})); };
  const delCard  = (id) => upd(d => ({ ...d, cards:d.cards.filter(c=>c.id!==id) }));
  const saveInst = (key,val) => upd(d => ({ ...d, monthlyInstallments:{...d.monthlyInstallments,[key]:val} }));
  const delInst  = (key) => upd(d => { const m={...d.monthlyInstallments}; delete m[key]; return {...d,monthlyInstallments:m}; });

  const NAV = [["today","◉","Hoje"],["costs","≡","Custos"],["future","◌","Futuro"],["simulator","⟳","Simular"],["help","?","Ajuda"]];
  const familyCode = data.familyCode || profile?.families?.invite_code || ""

  return (
    <div style={{minHeight:"100vh",background:"#F5F4EF",fontFamily:"'DM Sans',sans-serif",paddingBottom:80}}>
      <GS />
      <div style={{background:"#FFD000",padding:"16px 20px 18px"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>
            <div style={{display:"flex",alignItems:"center",gap:6}}>
              <div style={{fontSize:11,fontWeight:700,letterSpacing:3,color:"rgba(0,0,0,.4)",textTransform:"uppercase"}}>Finanças</div>
              {syncing && <div style={{fontSize:9,fontWeight:700,color:"rgba(0,0,0,.3)",background:"rgba(0,0,0,.08)",padding:"2px 6px",borderRadius:8}}>↑ salvando</div>}
            </div>
            <div style={{fontSize:26,fontWeight:900,color:"#000",marginTop:2,lineHeight:1}}>Olá, {profile?.name || data.members[0]?.name||"Você"} 👋</div>
          </div>
          <button onClick={() => setProfileOpen(true)} style={{background:"rgba(0,0,0,.12)",border:"none",borderRadius:20,padding:"7px 14px",fontWeight:700,fontSize:12,cursor:"pointer"}}>👤 Perfil</button>
        </div>
        {data.streak>1 && <div style={{marginTop:8,fontSize:12,fontWeight:700,color:"rgba(0,0,0,.6)"}}>🔥 {data.streak} dias no limite</div>}
      </div>

      <div style={{padding:"16px 16px 0"}}>
        {view==="today"     && <TodayView da={da} rem={rem} over={over} dailyBase={dailyBase} tSpent={tSpent} tVar={tVar} cy={cy} cyExp={cyExp} freeMoney={freeMoney} freeSpent={freeSpent} onAdd={addExp} onDel={delExp} fmt={fmt} fmtS={fmtS} fmtD={fmtD} />}
        {view==="costs"     && <CostsView data={{...data,categories,freeMoney,monthlyInstallments:instMap}} tFixed={tFixed} tVar={tVar} tInst={tInst} savAmt={savAmt} tFree={tFree} freeSaldo={freeSaldo} saveCat={saveCat} delCat={delCat} saveCard={saveCard} delCard={delCard} saveInst={saveInst} delInst={delInst} upd={upd} fmt={fmt} fmtS={fmtS} />}
        {view==="future"    && <FutureView months={futureMonths} fmt={fmt} fmtS={fmtS} />}
        {view==="simulator" && <SimulatorView data={data} months={futureMonths} savAmt={savAmt} fmt={fmt} saveInst={saveInst} />}
        {view==="help"      && <HelpView />}
      </div>

      <nav style={{position:"fixed",bottom:0,left:0,right:0,background:"#fff",borderTop:"1px solid #EBEBEB",display:"flex",justifyContent:"space-around",padding:"8px 0 14px",zIndex:50}}>
        {NAV.map(([id,ic,lb]) => (
          <button key={id} onClick={() => setView(id)} style={{background:"none",border:"none",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:3,fontSize:10,fontWeight:700,color:view===id?"#000":"#C0C0C0"}}>
            <div style={{width:38,height:38,borderRadius:12,background:view===id?"#FFD000":"#F5F4EF",display:"flex",alignItems:"center",justifyContent:"center",fontSize:17}}>{ic}</div>
            {lb}
          </button>
        ))}
      </nav>

      {profileOpen && (
        <Mdl title="👤 Perfil" onClose={() => setProfileOpen(false)}>
          <div style={{background:"#F5F4EF",borderRadius:14,padding:"14px 16px"}}>
            <div style={{fontSize:11,fontWeight:700,color:"#bbb",letterSpacing:1,marginBottom:6}}>FAMÍLIA · {profile?.families?.name}</div>
            <div style={{fontSize:11,fontWeight:700,color:"#bbb",letterSpacing:1,marginBottom:4}}>CÓDIGO DE CONVITE</div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{fontSize:24,fontWeight:900,letterSpacing:4}}>{familyCode}</div>
              <button className="btn-y" style={{width:"auto",padding:"8px 14px",fontSize:12}} onClick={() => navigator.clipboard?.writeText(familyCode)}>Copiar</button>
            </div>
            <div style={{fontSize:11,color:"#bbb",marginTop:4}}>Compartilhe com quem quiser dar acesso</div>
          </div>
          {data.members.map(m => (
            <div key={m.id} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",background:"#fff",borderRadius:12,border:"1px solid #E8E8E8"}}>
              <div style={{width:36,height:36,borderRadius:"50%",background:"#FFD000",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900,fontSize:14}}>{m.name[0]}</div>
              <div style={{flex:1}}>
                <div style={{fontSize:14,fontWeight:700}}>{m.name}</div>
                <div style={{fontSize:11,color:"#bbb"}}>{m.role==="master"?"👑 Master":"👤 Membro"}</div>
              </div>
            </div>
          ))}
          <button className="btn-out" onClick={onLogout} style={{width:"100%",color:"#E85D4A",borderColor:"#FECACA"}}>Sair da conta</button>
        </Mdl>
      )}
    </div>
  );
}

// ─── Currency Input ───────────────────────────────────────────────────────────
function CurrencyInput({ value, onChange, placeholder }) {
  const [display, setDisplay] = useState(value ? formatCurrency(value) : "");

  function formatCurrency(val) {
    const num = String(val).replace(/[^0-9]/g, "");
    if (!num) return "";
    const n = parseInt(num, 10) / 100;
    return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  const handleChange = (e) => {
    const raw = e.target.value.replace(/[^0-9]/g, "");
    setDisplay(formatCurrency(raw));
    onChange(raw ? String(parseInt(raw, 10) / 100) : "");
  };

  return (
    <div style={{ position: "relative" }}>
      <span style={{ position:"absolute", left:14, top:"50%", transform:"translateY(-50%)", fontSize:14, fontWeight:700, color:"#000", pointerEvents:"none" }}>R$</span>
      <input className="inp" style={{ paddingLeft: 38 }} placeholder={placeholder || "0,00"} value={display} onChange={handleChange} inputMode="numeric" />
    </div>
  );
}

// ─── Today View ───────────────────────────────────────────────────────────────
function TodayView({ da, rem, over, dailyBase, tSpent, tVar, cy, cyExp, freeMoney, freeSpent, onAdd, onDel, fmt, fmtS, fmtD }) {
  const [modal, setModal] = useState(false);
  const [ef, setEf] = useState({ description:"", amount:"", date:new Date().toISOString().split("T")[0], pool:"family", memberId:"master", isRefund:false, isIncome:false });
  const todaySp  = da[cy.cur]?.sp||0;
  const todayAl  = da[cy.cur]?.al||dailyBase;
  const todayPct = Math.min((todaySp/todayAl)*100,100);
  const budPct   = Math.min((tSpent/tVar)*100,100);
  const submit = () => {
    if (!ef.description || !ef.amount) return;
    const amount = parseFloat(ef.amount.replace ? ef.amount.replace(/[^0-9,]/g,"").replace(",",".") : ef.amount) || 0;
    if (amount <= 0) return;
    onAdd({...ef, amount, isRefund: ef.isIncome ? true : ef.isRefund});
    setEf({description:"",amount:"",date:new Date().toISOString().split("T")[0],pool:"family",memberId:"master",isRefund:false,isIncome:false});
    setModal(false);
  };
  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <div style={{background:"#000",borderRadius:24,padding:"24px 20px 20px"}}>
        <div style={{display:"flex",justifyContent:"flex-end",marginBottom:8}}>
          <button onClick={() => alert("Este é quanto você pode gastar HOJE. Se sobrar, divide pelos dias seguintes. Se gastar mais, desconta dos próximos. Sempre um alvo claro! 🎯")} style={{background:"rgba(255,208,0,.15)",border:"none",borderRadius:16,padding:"5px 10px",fontSize:11,fontWeight:700,color:"#FFD000",cursor:"pointer"}}>❓ O que é isso?</button>
        </div>
        <div style={{textAlign:"center"}}>
          <div style={{fontSize:10,fontWeight:700,letterSpacing:3,color:"rgba(255,255,255,.3)",textTransform:"uppercase",marginBottom:10}}>{over?"⚠️ Acima do limite":"💛 Disponível hoje"}</div>
          <div style={{fontSize:68,fontWeight:900,color:over?"#E85D4A":"#FFD000",lineHeight:1}}>{fmtD(rem)}</div>
          <div style={{fontSize:11,color:"rgba(255,255,255,.25)",marginTop:6}}>Dia {cy.cur} de {cy.total} do ciclo</div>
          {over && <div style={{fontSize:11,fontWeight:700,color:"#E85D4A",marginTop:4}}>Redistribuído nos próximos dias</div>}
          <div style={{marginTop:16,display:"flex",justifyContent:"center",gap:28,paddingTop:14,borderTop:"1px solid rgba(255,255,255,.06)"}}>
            {[["Gasto hoje",fmtD(todaySp)],["Média diária",fmtD(dailyBase)],["Orçamento",fmtS(tVar)]].map(([l,v],i) => (
              <div key={i} style={{textAlign:"center"}}>
                <div style={{fontSize:9,fontWeight:700,color:"rgba(255,255,255,.25)",letterSpacing:1}}>{l}</div>
                <div style={{fontSize:15,fontWeight:700,color:"rgba(255,255,255,.55)",marginTop:2}}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{background:"rgba(255,255,255,.08)",borderRadius:4,height:4,marginTop:14,overflow:"hidden"}}>
            <div style={{height:"100%",background:over?"#E85D4A":"#FFD000",borderRadius:4,width:`${todayPct}%`,transition:"width .6s"}} />
          </div>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        {[["Usado no ciclo",fmtS(tSpent),`${budPct.toFixed(0)}%`,budPct,budPct>90?"#E85D4A":"#FFD000"],["Dias restantes",String(cy.total-cy.cur),`de ${cy.total}`,(cy.cur/cy.total)*100,"#000"]].map(([l,v,s,pct,c],i) => (
          <div key={i} style={{background:"#fff",borderRadius:16,padding:14,border:"1px solid #E8E8E8"}}>
            <div style={{fontSize:10,fontWeight:700,color:"#bbb",marginBottom:6}}>{l}</div>
            <div style={{fontSize:24,fontWeight:900}}>{v}</div>
            <div style={{background:"#F5F4EF",borderRadius:3,height:4,marginTop:8,overflow:"hidden"}}>
              <div style={{height:"100%",background:c,width:`${Math.min(pct,100)}%`,borderRadius:3}} />
            </div>
            <div style={{fontSize:10,fontWeight:700,color:"#bbb",marginTop:4}}>{s}</div>
          </div>
        ))}
      </div>
      {freeMoney.map((f,i) => {
        const sp=freeSpent[f.memberId]||0, rem2=Math.max(f.amount-sp,0), pct=Math.min((sp/f.amount)*100,100), done=rem2<=0;
        return (
          <div key={i} style={{background:"#fff",borderRadius:16,padding:14,border:`1px solid ${done?"#FECACA":"#E8E8E8"}`}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
              <div>
                <div style={{fontSize:13,fontWeight:700}}>💛 {f.name} — livre</div>
                <div style={{fontSize:11,color:"#bbb",marginTop:2}}>{done?"💸 Esgotado":`${fmt(rem2)} restam de ${fmt(f.amount)}`}</div>
              </div>
              <div style={{fontSize:22,fontWeight:900,color:done?"#E85D4A":"#000"}}>{fmtD(rem2)}</div>
            </div>
            <div style={{background:"#F5F4EF",borderRadius:3,height:4,marginTop:8,overflow:"hidden"}}>
              <div style={{height:"100%",background:done?"#E85D4A":"#FFD000",width:`${pct}%`,borderRadius:3}} />
            </div>
          </div>
        );
      })}
      <div style={{background:"#fff",borderRadius:16,padding:14,border:"1px solid #E8E8E8"}}>
        <div style={{fontSize:12,color:"#bbb",marginBottom:10,lineHeight:1.5}}>💡 Lance um por um ou some tudo na manhã do dia seguinte — como preferir!</div>
        <button className="btn-y" onClick={() => setModal(true)}>+ Adicionar lançamento</button>
      </div>
      <div style={{background:"#fff",borderRadius:16,padding:14,border:"1px solid #E8E8E8"}}>
        <div style={{display:"flex",flexWrap:"wrap",gap:3,marginBottom:10}}>
          {Array.from({length:cy.total},(_,i) => {
            const d=i+1,info=da[d],isT=d===cy.cur,isPast=d<cy.cur;
            const sur=isPast?info?.diff:0;
            const bg=isT?"#FFD000":isPast?(sur>=0?"#DCFCE7":"#FEE2E2"):"#F5F4EF";
            const tc=isT?"#000":isPast?(sur>=0?"#166534":"#991B1B"):"#bbb";
            return <div key={d} style={{width:"calc(14.28% - 3px)",aspectRatio:"1",borderRadius:6,background:bg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:isT?900:500,color:tc}}>{d}</div>;
          })}
        </div>
        <div style={{display:"flex",gap:10,fontSize:10,fontWeight:700,color:"#bbb"}}>
          <span>🟢 sobrou</span><span>🔴 passou</span><span style={{background:"#FFD000",color:"#000",padding:"1px 6px",borderRadius:8}}>hoje</span>
        </div>
      </div>
      {cyExp.length > 0 && (
        <div style={{background:"#fff",borderRadius:16,overflow:"hidden",border:"1px solid #E8E8E8"}}>
          <div style={{padding:"12px 16px",borderBottom:"1px solid #F5F4EF",fontSize:11,fontWeight:700,letterSpacing:.5,color:"#bbb"}}>LANÇAMENTOS RECENTES</div>
          {[...cyExp].reverse().slice(0,8).map(e => (
            <div key={e.id} style={{display:"flex",alignItems:"center",padding:"11px 16px",borderBottom:"1px solid #F9F9F6",gap:10}}>
              <div style={{width:8,height:8,borderRadius:"50%",background:e.pool==="free"?"#FFD000":e.isIncome||e.isRefund?"#10B981":"#000",flexShrink:0}} />
              <div style={{flex:1}}>
                <div style={{fontSize:14,fontWeight:600,color:e.isIncome||e.isRefund?"#10B981":"#000"}}>{e.isIncome?"💰 ":e.isRefund?"↩ ":""}{e.description}</div>
                <div style={{fontSize:10,fontWeight:700,color:"#bbb",marginTop:1}}>{new Date(e.date+"T12:00:00").toLocaleDateString("pt-BR",{day:"2-digit",month:"short"})} {e.pool==="free"?"· 💛 livre":""}</div>
              </div>
              <div style={{fontSize:14,fontWeight:700,color:e.isIncome||e.isRefund?"#10B981":"#000"}}>{e.isIncome||e.isRefund?"+":""}{fmt(e.amount)}</div>
              <button onClick={() => onDel(e.id)} style={{background:"none",border:"none",color:"#ddd",cursor:"pointer",fontSize:16}}>✕</button>
            </div>
          ))}
        </div>
      )}
      {modal && (
        <Mdl title="📝 Adicionar lançamento" onClose={() => setModal(false)}>
          <div>
            <div style={{fontSize:12,fontWeight:700,color:"#666",marginBottom:6}}>Tipo de lançamento</div>
            <div className="seg">
              <button className={"sb"+(!ef.isIncome?" on":"")} onClick={() => setEf(f => ({...f,isIncome:false,isRefund:false}))}>💸 Despesa</button>
              <button className={"sb"+(ef.isIncome?" on":"")} onClick={() => setEf(f => ({...f,isIncome:true,isRefund:false,pool:"family"}))}>💰 Entrada / Reembolso</button>
            </div>
          </div>
          <input className="inp" placeholder={ef.isIncome?"Descrição (ex: reembolso, freelance...)":"O que foi? (ex: mercado, posto...)"} value={ef.description} onChange={e => setEf(f => ({...f,description:e.target.value}))} autoFocus />
          <CurrencyInput value={ef.amount} onChange={v => setEf(f => ({...f,amount:v}))} />
          <input className="inp" type="date" value={ef.date} onChange={e => setEf(f => ({...f,date:e.target.value}))} />
          {!ef.isIncome && freeMoney.length > 0 && (
            <div>
              <div style={{fontSize:12,fontWeight:700,color:"#666",marginBottom:6}}>Esse gasto é de:</div>
              <div className="seg">
                <button className={"sb"+(ef.pool==="family"?" on":"")} onClick={() => setEf(f => ({...f,pool:"family"}))}>🏠 Família</button>
                {freeMoney.map(f => {
                  const done=(freeSpent[f.memberId]||0)>=f.amount;
                  return <button key={f.memberId} className={"sb"+(ef.pool==="free"&&ef.memberId===f.memberId?" on":"")} disabled={done} onClick={() => !done&&setEf(fp=>({...fp,pool:"free",memberId:f.memberId}))} style={{opacity:done?.4:1}}>💛 {f.name}{done?" ✗":""}</button>;
                })}
              </div>
            </div>
          )}
          {ef.isIncome && <div style={{fontSize:12,color:"#10B981",background:"#F0FDF4",borderRadius:8,padding:"8px 12px"}}>✅ Esse valor será adicionado ao seu saldo diário disponível.</div>}
          <button className="btn-y" onClick={submit}>Confirmar lançamento</button>
        </Mdl>
      )}
    </div>
  );
}

// ─── Costs View ───────────────────────────────────────────────────────────────
function CostsView({ data, tFixed, tVar, tInst, savAmt, tFree, freeSaldo, saveCat, delCat, saveCard, delCard, saveInst, delInst, upd, fmt, fmtS }) {
  const [cm,setCm]     = useState(false);
  const [kdm,setKdm]   = useState(false);
  const [eid,setEid]   = useState(null);
  const [cf,setCf]     = useState({name:"",type:"variable",amount:"",paymentType:"debit",cardId:"",dueDay:""});
  const [kf,setKf]     = useState({name:"",closingDay:"",closingLast:false,dueDay:"",dueDayType:"fixed"});
  const [editInst,setEditInst] = useState(null);
  const [instVal,setInstVal]   = useState("");
  const [editInc,setEditInc]   = useState(false);
  const [incV,setIncV]         = useState(data.income.toString());
  const [editSav,setEditSav]   = useState(false);
  const [savV,setSavV]         = useState(data.savingsAmount.toString());

  const vCats = data.categories.filter(c => c.type==="variable");
  const fCats = data.categories.filter(c => c.type==="fixed");

  const instMonthKeys = useMemo(() => {
    return Array.from({length:13},(_,i) => {
      const m=(NOW.getMonth()+i)%12, y=NOW.getFullYear()+Math.floor((NOW.getMonth()+i)/12);
      return {key:`${y}-${m}`,label:`${MS[m]}/${y}`};
    });
  }, []);

  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <div style={{background:"#fff",borderRadius:16,padding:16,border:"1px solid #E8E8E8"}}>
        <div style={{fontSize:10,fontWeight:700,color:"#bbb",marginBottom:6}}>RENDA MENSAL TOTAL</div>
        {editInc
          ? <input className="inp" type="number" value={incV} autoFocus style={{fontSize:22,fontWeight:900}} onChange={e=>setIncV(e.target.value)} onBlur={() => {upd(d=>({...d,income:parseFloat(incV)||d.income}));setEditInc(false);}} />
          : <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{fontSize:28,fontWeight:900}}>{fmt(data.income)}</div>
              <button onClick={()=>setEditInc(true)} style={{background:"#F5F4EF",border:"none",borderRadius:10,padding:"8px 14px",fontSize:12,fontWeight:700,cursor:"pointer"}}>✎ Editar</button>
            </div>}
      </div>

      <div style={{background:"#000",borderRadius:16,padding:16}}>
        {[["🔒 Fixos",tFixed],["📦 Parcelas (mês atual)",tInst],["💛 Variáveis",tVar],tFree>0&&["🆓 Livre",tFree],data.savings&&["🏦 Poupança",savAmt]].filter(Boolean).map(([l,v]) => (
          <div key={l} style={{display:"flex",justifyContent:"space-between",marginBottom:10}}>
            <span style={{fontSize:13,color:"rgba(255,255,255,.4)"}}>{l}</span>
            <span style={{fontSize:13,fontWeight:700,color:"rgba(255,255,255,.6)"}}>{fmt(v)}</span>
          </div>
        ))}
        <div style={{borderTop:"1px solid rgba(255,255,255,.08)",paddingTop:10,display:"flex",justifyContent:"space-between"}}>
          <span style={{fontSize:14,fontWeight:900,color:freeSaldo<0?"#E85D4A":"#FFD000"}}>{freeSaldo<0?"⚠️ Déficit":"✨ Saldo livre"}</span>
          <span style={{fontSize:14,fontWeight:900,color:freeSaldo<0?"#E85D4A":"#FFD000"}}>{fmt(Math.abs(freeSaldo))}</span>
        </div>
      </div>

      {[["💛 Variáveis",vCats,"variable",`Pool do orçamento diário · ${fmt(tVar)}/ciclo`],["🔒 Fixos",fCats,"fixed",`${fmt(tFixed)}/ciclo`]].map(([title,list,type,sub]) => (
        <div key={type}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <div><div style={{fontSize:14,fontWeight:900}}>{title}</div><div style={{fontSize:11,color:"#bbb"}}>{sub}</div></div>
            <button className="btn-out" onClick={()=>{setCf({name:"",type,amount:"",paymentType:"debit",cardId:"",dueDay:""});setEid(null);setCm(true);}}>+ Add</button>
          </div>
          <div style={{background:"#fff",borderRadius:14,overflow:"hidden",border:"1px solid #E8E8E8"}}>
            {list.map(c => {
              const card=data.cards.find(x=>x.id===c.cardId);
              return (
                <div key={c.id} style={{display:"flex",alignItems:"center",padding:"12px 14px",borderBottom:"1px solid #F9F9F6",gap:10}}>
                  <div style={{flex:1}}>
                    <div style={{fontSize:14,fontWeight:600}}>{c.name}</div>
                    <div style={{display:"flex",gap:6,marginTop:3}}>
                      <span style={{fontSize:10,fontWeight:700,color:c.paymentType==="credit"?"#1D4ED8":"#166534",background:c.paymentType==="credit"?"#EFF6FF":"#F0FDF4",padding:"1px 7px",borderRadius:20}}>{c.paymentType==="credit"?"Crédito":"Déb/Pix/Din"}</span>
                      {card && <span style={{fontSize:10,fontWeight:700,color:"#666",background:"#F5F4EF",padding:"1px 7px",borderRadius:20}}>💳 {card.name}</span>}
                    </div>
                  </div>
                  <div style={{fontSize:14,fontWeight:900}}>{fmt(c.amount)}</div>
                  <button onClick={()=>{setCf({name:c.name,type:c.type,amount:c.amount.toString(),paymentType:c.paymentType,cardId:c.cardId||"",dueDay:c.dueDay||""});setEid(c.id);setCm(true);}} style={{background:"none",border:"none",color:"#bbb",cursor:"pointer",fontSize:14}}>✎</button>
                  <button onClick={()=>delCat(c.id)} style={{background:"none",border:"none",color:"#E85D4A",cursor:"pointer",fontSize:16}}>✕</button>
                </div>
              );
            })}
            {list.length===0 && <div style={{padding:14,fontSize:13,color:"#bbb",textAlign:"center"}}>Nenhuma categoria</div>}
          </div>
        </div>
      ))}

      <div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
          <div style={{fontSize:14,fontWeight:900}}>💳 Meus cartões de crédito</div>
          <button className="btn-out" onClick={()=>{setKf({name:"",closingDay:"",closingLast:false,dueDay:"",dueDayType:"fixed"});setKdm(true);}}>+ Add</button>
        </div>
        {data.cards.map(c => (
          <div key={c.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:"#fff",borderRadius:12,padding:"12px 14px",border:"1px solid #E8E8E8",marginBottom:8}}>
            <div>
              <div style={{fontSize:14,fontWeight:700}}>💳 {c.name}{c.id===data.primaryCard&&<span style={{fontSize:10,fontWeight:700,background:"#FFD000",padding:"1px 7px",borderRadius:20,marginLeft:8}}>Principal</span>}</div>
              <div style={{fontSize:11,color:"#bbb",marginTop:2}}>Fecha: {c.closingDay==="last"?"último dia":"dia "+c.closingDay} · Vence: {c.dueDayType==="after"?c.dueDay+"d após":"dia "+c.dueDay}</div>
            </div>
            <button onClick={()=>delCard(c.id)} style={{background:"none",border:"none",color:"#E85D4A",cursor:"pointer",fontSize:18}}>✕</button>
          </div>
        ))}
      </div>

      <div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
          <div><div style={{fontSize:14,fontWeight:900}}>📦 Parcelas por mês</div><div style={{fontSize:11,color:"#bbb"}}>{fmt(tInst)} este mês</div></div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
          {instMonthKeys.map(({key,label}) => {
            const val=data.monthlyInstallments[key];
            const hasVal=val&&parseFloat(val)>0;
            return (
              <button key={key} onClick={()=>{setEditInst(key);setInstVal(val?String(val):"");}} style={{background:hasVal?"#000":"#F5F4EF",border:`1px solid ${hasVal?"#000":"#E8E8E8"}`,borderRadius:10,padding:"10px 8px",cursor:"pointer",textAlign:"center"}}>
                <div style={{fontSize:11,fontWeight:700,color:hasVal?"#FFD000":"#666"}}>{label}</div>
                {hasVal ? <div style={{fontSize:10,color:"rgba(255,208,0,.7)",marginTop:2}}>{fmtS(parseFloat(val))}</div> : <div style={{fontSize:10,color:"#ccc",marginTop:2}}>—</div>}
              </button>
            );
          })}
        </div>
        {editInst!==null && (
          <Mdl title={`Parcelas — ${editInst}`} onClose={()=>setEditInst(null)}>
            <input className="inp" type="number" placeholder="Total de parcelas (R$)" style={{fontSize:22,fontWeight:900,textAlign:"center"}} value={instVal} onChange={e=>setInstVal(e.target.value)} autoFocus />
            <button className="btn-y" onClick={()=>{saveInst(editInst,parseFloat(instVal)||0);setEditInst(null);}}>Salvar</button>
            <button className="btn-out" onClick={()=>{delInst(editInst);setEditInst(null);}}>Remover valor</button>
          </Mdl>
        )}
      </div>

      <div style={{background:data.savings?"#FFF9E6":"#fff",borderRadius:16,padding:16,border:`1px solid ${data.savings?"#FFD000":"#E8E8E8"}`}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:data.savings?12:0}}>
          <div>
            <div style={{fontSize:14,fontWeight:900}}>🏦 Poupança</div>
            {data.savings && <div style={{fontSize:11,color:"#b8860b",marginTop:2}}>Reservada antes dos gastos</div>}
          </div>
          <button className={"tog"+(data.savings?" on":"")} onClick={()=>upd(d=>({...d,savings:!d.savings}))} />
        </div>
        {data.savings && (editSav
          ? <input className="inp" type="number" value={savV} autoFocus onChange={e=>setSavV(e.target.value)} onBlur={()=>{upd(d=>({...d,savingsAmount:parseFloat(savV)||d.savingsAmount}));setEditSav(false);}} />
          : <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{fontSize:22,fontWeight:900,color:"#b8860b"}}>{fmt(savAmt)}/mês</div>
              <button onClick={()=>setEditSav(true)} style={{background:"#FFF9E6",border:"none",borderRadius:10,padding:"8px 14px",fontSize:12,fontWeight:700,cursor:"pointer",color:"#b8860b"}}>✎ Editar</button>
            </div>
        )}
      </div>

      {cm && <Mdl title={eid?"Editar categoria":"Nova categoria"} onClose={()=>{setCm(false);setEid(null);}}>
        <input className="inp" placeholder="Nome" value={cf.name} onChange={e=>setCf(f=>({...f,name:e.target.value}))} />
        <input className="inp" type="number" placeholder="Valor mensal (R$)" value={cf.amount} onChange={e=>setCf(f=>({...f,amount:e.target.value}))} />
        <div className="seg">
          <button className={"sb"+(cf.type==="variable"?" on":"")} onClick={()=>setCf(f=>({...f,type:"variable"}))}>💛 Variável</button>
          <button className={"sb"+(cf.type==="fixed"?" on":"")} onClick={()=>setCf(f=>({...f,type:"fixed"}))}>🔒 Fixo</button>
        </div>
        <div className="seg">
          <button className={"sb"+(cf.paymentType==="debit"?" on":"")} onClick={()=>setCf(f=>({...f,paymentType:"debit"}))}>Débito/Pix</button>
          <button className={"sb"+(cf.paymentType==="credit"?" on":"")} onClick={()=>setCf(f=>({...f,paymentType:"credit"}))}>Crédito</button>
        </div>
        {cf.paymentType==="credit"&&data.cards.length>0&&<select className="sel" value={cf.cardId} onChange={e=>setCf(f=>({...f,cardId:e.target.value}))}><option value="">Selecionar cartão</option>{data.cards.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>}
        <button className="btn-y" onClick={()=>{saveCat(cf,eid);setCm(false);setEid(null);}}>{eid?"Salvar":"Adicionar"}</button>
      </Mdl>}

      {kdm && <Mdl title="Novo cartão" onClose={()=>setKdm(false)}>
        <input className="inp" placeholder="Nome (ex: Nubank)" value={kf.name} onChange={e=>setKf(f=>({...f,name:e.target.value}))} />
        <div style={{fontSize:12,fontWeight:700,color:"#666"}}>Qual dia a fatura fecha?</div>
        <div style={{display:"flex",gap:8}}>
          <input className="inp" type="number" placeholder="Dia" value={kf.closingLast?"":kf.closingDay} onChange={e=>setKf(f=>({...f,closingDay:e.target.value}))} style={{flex:1}} disabled={kf.closingLast} />
          <button onClick={()=>setKf(f=>({...f,closingLast:!f.closingLast}))} style={{background:kf.closingLast?"#000":"#F5F4EF",color:kf.closingLast?"#FFD000":"#666",border:"2px solid #E8E8E8",borderRadius:12,padding:"0 12px",fontSize:12,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>Último dia do mês</button>
        </div>
        <div className="seg">
          <button className={"sb"+(kf.dueDayType==="fixed"?" on":"")} onClick={()=>setKf(f=>({...f,dueDayType:"fixed"}))}>Dia fixo</button>
          <button className={"sb"+(kf.dueDayType==="after"?" on":"")} onClick={()=>setKf(f=>({...f,dueDayType:"after"}))}>X dias após</button>
        </div>
        <input className="inp" type="number" placeholder={kf.dueDayType==="fixed"?"Dia do vencimento":"Dias após fechamento"} value={kf.dueDay} onChange={e=>setKf(f=>({...f,dueDay:e.target.value}))} />
        <button className="btn-y" onClick={()=>{saveCard(kf);setKdm(false);}}>Adicionar</button>
      </Mdl>}
    </div>
  );
}

// ─── Future View ──────────────────────────────────────────────────────────────
function FutureView({ months, fmt, fmtS }) {
  const [selected, setSelected] = useState(null);
  const maxBal = Math.max(...months.map(m => Math.abs(m.balance)), 1);
  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <p style={{fontSize:13,color:"#999"}}>Projeção de 24 meses. Toque num mês para ver os detalhes. 📈</p>
      <div style={{background:"#fff",borderRadius:16,padding:16,border:"1px solid #E8E8E8"}}>
        <div style={{fontSize:13,fontWeight:900,marginBottom:10}}>Evolução do saldo projetado</div>
        <div style={{display:"flex",gap:2,alignItems:"flex-end",height:80,overflowX:"auto"}}>
          {months.map((m,i) => {
            const h = Math.max((Math.abs(m.balance)/maxBal)*80, 3);
            return (
              <div key={i} onClick={() => setSelected(selected===i?null:i)} style={{flex:"0 0 calc(100%/12)",minWidth:24,display:"flex",flexDirection:"column",alignItems:"center",gap:2,cursor:"pointer"}}>
                <div style={{height:h,background:m.balance<0?"#E85D4A":selected===i?"#FFD000":i===0?"#FFD000":"#DCFCE7",borderRadius:"3px 3px 0 0",width:"100%",opacity:selected!==null&&selected!==i?.5:1,transition:"opacity .2s"}} />
                <div style={{fontSize:8,fontWeight:700,color:i===0||selected===i?"#000":"#bbb"}}>{m.label}</div>
              </div>
            );
          })}
        </div>
      </div>
      {selected !== null && (
        <div style={{background:"#FFD000",borderRadius:16,padding:16}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <div style={{fontSize:16,fontWeight:900}}>{months[selected].label} {months[selected].year}</div>
            <button onClick={()=>setSelected(null)} style={{background:"rgba(0,0,0,.1)",border:"none",borderRadius:"50%",width:28,height:28,cursor:"pointer",fontWeight:700}}>✕</button>
          </div>
          {[
            ["💛 Orçamento variável", fmt(months[selected].variable)],
            ["📦 Parcelas", fmt(months[selected].inst)],
            ["💛 Orçamento diário", `${fmt(months[selected].daily)}/dia`],
            ["📊 Resultado do mês", (months[selected].monthlyResult>=0?"+":"")+fmt(months[selected].monthlyResult)],
            ["🏦 Saldo projetado", fmt(months[selected].balance)],
          ].map(([l,v]) => (
            <div key={l} style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
              <span style={{fontSize:13,color:"rgba(0,0,0,.6)"}}>{l}</span>
              <span style={{fontSize:13,fontWeight:900}}>{v}</span>
            </div>
          ))}
        </div>
      )}
      {months.map((m,i) => (
        <div key={i} style={{background:i===0?"#000":"#fff",borderRadius:16,padding:"14px 16px",border:`1px solid ${m.isRed?"#FECACA":i===0?"transparent":"#E8E8E8"}`}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
            <div>
              <div style={{fontSize:14,fontWeight:900,color:i===0?"#FFD000":"#000"}}>{m.label} {m.year}{i===0?" · Atual":""}</div>
              <div style={{marginTop:6,display:"flex",flexDirection:"column",gap:3}}>
                {m.inst>0 ? <div style={{fontSize:11,fontWeight:700,color:i===0?"rgba(255,255,255,.4)":"#bbb"}}>📦 Parcelas: {fmt(m.inst)}</div> : <div style={{fontSize:11,fontWeight:700,color:"#10B981"}}>✅ Sem parcelas!</div>}
                <div style={{fontSize:11,fontWeight:700,color:i===0?"rgba(255,255,255,.4)":"#bbb"}}>💛 Orçamento: {fmt(m.daily)}/dia</div>
                <div style={{fontSize:11}}>
                  <span style={{color:i===0?"rgba(255,255,255,.4)":"#bbb"}}>Resultado do mês: </span>
                  <span style={{fontWeight:900,color:m.monthlyResult<0?"#E85D4A":i===0?"#FFD000":"#166534"}}>{m.monthlyResult>=0?"+":""}{fmt(m.monthlyResult)}</span>
                </div>
              </div>
            </div>
            <div style={{textAlign:"right"}}>
              <div style={{fontSize:11,fontWeight:700,color:i===0?"rgba(255,255,255,.3)":"#bbb",marginBottom:2}}>Saldo projetado</div>
              <div style={{fontSize:22,fontWeight:900,color:m.isRed?"#E85D4A":i===0?"#FFD000":"#000"}}>{fmtS(m.balance)}</div>
              {m.isRed && <div style={{fontSize:10,fontWeight:700,color:"#E85D4A",marginTop:2}}>⚠️ Negativo</div>}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Simulator View ───────────────────────────────────────────────────────────
function SimulatorView({ data, months, savAmt, fmt, saveInst }) {
  const [f,setF]     = useState({name:"",totalAmount:"",count:"10"});
  const [res,setRes] = useState(null);
  const [sm,setSm]   = useState(false);
  const [sfKey,setSfKey] = useState("");

  const run = () => {
    if (!f.totalAmount || !f.count) return;
    const monthly = parseFloat(f.totalAmount)/parseInt(f.count);
    setRes({
      monthly, name: f.name||"Nova compra",
      results: months.map((m,i) => {
        const aff = i < parseInt(f.count);
        const nf  = aff ? m.freeSaldo - monthly : m.freeSaldo;
        return {...m, nf, aff, status: nf<0?"red": nf<savAmt*.5?"yellow":"green"};
      }),
    });
  };

  const sc = res ? {r:res.results.filter(x=>x.status==="red"&&x.aff).length,y:res.results.filter(x=>x.status==="yellow"&&x.aff).length} : {};

  const mOpts = Array.from({length:12},(_,i) => {
    const m=(NOW.getMonth()+i)%12, y=NOW.getFullYear()+Math.floor((NOW.getMonth()+i)/12);
    return {key:`${y}-${m}`,label:`${MS[m]}/${y}`};
  });

  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <div style={{background:"#000",borderRadius:20,padding:20}}>
        <div style={{fontSize:10,fontWeight:900,letterSpacing:3,color:"rgba(255,255,255,.3)",textTransform:"uppercase",marginBottom:6}}>🔮 Simulador de compra</div>
        <p style={{fontSize:13,color:"rgba(255,255,255,.4)",lineHeight:1.6,marginBottom:14}}>Simule antes de parcelar. Decida com informação, não na emoção.</p>
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          <input className="inp" style={{background:"rgba(255,255,255,.08)",borderColor:"rgba(255,255,255,.1)",color:"#fff"}} placeholder="O que quer comprar?" value={f.name} onChange={e=>setF(x=>({...x,name:e.target.value}))} />
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <input className="inp" style={{background:"rgba(255,255,255,.08)",borderColor:"rgba(255,255,255,.1)",color:"#fff"}} type="number" placeholder="Valor total (R$)" value={f.totalAmount} onChange={e=>setF(x=>({...x,totalAmount:e.target.value}))} />
            <input className="inp" style={{background:"rgba(255,255,255,.08)",borderColor:"rgba(255,255,255,.1)",color:"#fff"}} type="number" placeholder="Parcelas" value={f.count} onChange={e=>setF(x=>({...x,count:e.target.value}))} />
          </div>
          {f.totalAmount&&f.count&&<div style={{fontSize:13,fontWeight:700,color:"#FFD000",textAlign:"center"}}>{fmt(parseFloat(f.totalAmount)/parseInt(f.count))}/mês por {f.count} meses</div>}
          <button className="btn-y" onClick={run}>Simular →</button>
        </div>
      </div>
      {res && <>
        <div style={{background:sc.r>0?"#FEF2F2":sc.y>0?"#FFF9E6":"#F0FDF4",borderRadius:16,padding:16,border:`1px solid ${sc.r>0?"#FECACA":sc.y>0?"#FFD000":"#BBF7D0"}`}}>
          <div style={{fontSize:15,fontWeight:900,marginBottom:8,color:sc.r>0?"#E85D4A":sc.y>0?"#b8860b":"#166534"}}>
            {sc.r>0?"⚠️ Atenção!":sc.y>0?"🟡 Cabe, com ressalvas":"✅ Cabe no orçamento!"}
          </div>
          <p style={{fontSize:13,lineHeight:1.6,color:sc.r>0?"#991B1B":sc.y>0?"#92400E":"#166534"}}>
            {sc.r>0?`Vai deixar o orçamento negativo em ${sc.r} mês${sc.r!==1?"es":""}.`:sc.y>0?`Cabe, mas comprime a margem em ${sc.y} mês${sc.y!==1?"es":""}.`:"Cabe sem comprometer nada. Boa decisão! 🎯"}
          </p>
          <div style={{display:"flex",gap:8,marginTop:12}}>
            <button className="btn-y" style={{flex:2}} onClick={()=>setSm(true)}>Adicionar ao planejamento →</button>
            <button className="btn-out" style={{flex:1}} onClick={()=>setRes(null)}>Refazer</button>
          </div>
        </div>
        {res.results.filter(r=>r.aff).map((m,i) => (
          <div key={i} style={{background:"#fff",borderRadius:14,padding:14,border:`1px solid ${m.status==="red"?"#FECACA":m.status==="yellow"?"#FFD000":"#BBF7D0"}`}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
              <span style={{fontSize:13,fontWeight:700}}>{m.label} {m.year}</span>
              <span>{m.status==="red"?"🔴":m.status==="yellow"?"🟡":"🟢"}</span>
            </div>
            <div style={{fontSize:11,color:"#bbb",lineHeight:1.5}}>
              Parcela: <strong style={{color:"#000"}}>{fmt(res.monthly)}</strong><br/>
              Hoje: {fmt(m.freeSaldo)} → Com essa compra: <span style={{fontWeight:900,color:m.nf<0?"#E85D4A":"#166534"}}>{fmt(m.nf)}</span>
            </div>
          </div>
        ))}
      </>}
      {sm && <Mdl title="Adicionar ao planejamento" onClose={()=>setSm(false)}>
        <p style={{fontSize:13,color:"#666",lineHeight:1.6}}>A partir de qual mês essa parcela começa?</p>
        <select className="sel" value={sfKey} onChange={e=>setSfKey(e.target.value)}>
          <option value="">Selecione o mês de início</option>
          {mOpts.map(o=><option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
        <button className="btn-y" disabled={!sfKey} onClick={() => {
          if (!sfKey) return;
          const count = parseInt(f.count);
          const [ky, km] = sfKey.split("-").map(Number);
          for (let i = 0; i < count; i++) {
            const m = (km+i)%12, y = ky + Math.floor((km+i)/12);
            const key = `${y}-${m}`;
            const cur = data.monthlyInstallments[key]||0;
            saveInst(key, cur+res.monthly);
          }
          setSm(false); setRes(null);
        }}>Confirmar</button>
      </Mdl>}
    </div>
  );
}

// ─── Help View ────────────────────────────────────────────────────────────────
function HelpView() {
  const [open,setOpen] = useState(null);
  const faqs = [
    ["Por que meu limite diário muda todo dia?","O app redistribui automaticamente. Se sobrou de ontem, o valor extra é dividido pelos dias restantes — aumentando seu limite hoje. Se gastou mais, reduz. Sempre um alvo claro! 🎯"],
    ["O que são gastos Variáveis?","Gastos com teto mensal que podem variar — mercado, combustível, pet. A soma deles vira seu orçamento diário. Qualquer gasto não planejado (roupa, jantar) também sai desse pool."],
    ["O que são gastos Fixos?","Valores iguais todo mês — aluguel, Netflix. São descontados da renda mas NÃO afetam o limite diário."],
    ["O que é o dinheiro livre?","Uma quantia individual, sem justificativa. Se acabar, os próximos gastos saem do orçamento familiar. Dinheiro não tem carimbo! 😄"],
    ["Como funciona o saldo projetado?","O app usa seu saldo atual + renda - todas as saídas para projetar quanto você terá mês a mês."],
    ["Posso lançar tudo de uma vez?","Sim! Lance um por um ao longo do dia ou some tudo na manhã seguinte. O importante é o hábito regular."],
    ["O app precisa bater com meu saldo bancário?","Não! O app é um plano de voo, não um extrato. Se você seguir os limites, sua vida financeira vai estar saudável. ✈️"],
    ["O que é o simulador?","Antes de parcelar qualquer coisa, simule o impacto nos próximos meses. Decida com informação! 🔮"],
  ];
  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <div style={{background:"#000",borderRadius:20,padding:20}}>
        <div style={{fontSize:18,fontWeight:900,color:"#FFD000",marginBottom:16}}>Como funciona 💡</div>
        {[["1","Configure tudo","Renda, fixos, variáveis, parcelas e saldo atual."],["2","Limite diário","Soma dos variáveis ÷ dias do ciclo."],["3","Lance os gastos","Sem categorizar. O app redistribui sozinho."],["4","Decida com informação","Simule antes de parcelar. Veja o saldo futuro."]].map(([n,t,d]) => (
          <div key={n} style={{display:"flex",gap:12,alignItems:"flex-start",marginBottom:14}}>
            <div style={{width:28,height:28,borderRadius:"50%",background:"#FFD000",color:"#000",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:900,flexShrink:0}}>{n}</div>
            <div>
              <div style={{fontSize:14,fontWeight:700,color:"#fff"}}>{t}</div>
              <div style={{fontSize:12,color:"rgba(255,255,255,.35)",marginTop:2,lineHeight:1.5}}>{d}</div>
            </div>
          </div>
        ))}
      </div>
      <div style={{fontSize:11,fontWeight:900,color:"#bbb",letterSpacing:1}}>PERGUNTAS FREQUENTES</div>
      {faqs.map(([q,a],i) => (
        <div key={i} style={{background:"#fff",borderRadius:14,padding:14,border:"1px solid #E8E8E8",cursor:"pointer"}} onClick={() => setOpen(open===i?null:i)}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10}}>
            <div style={{fontSize:14,fontWeight:700,lineHeight:1.4}}>{q}</div>
            <div style={{color:"#bbb",fontSize:14,flexShrink:0}}>{open===i?"▲":"▼"}</div>
          </div>
          {open===i && <div style={{fontSize:13,color:"#666",marginTop:10,lineHeight:1.6,borderTop:"1px solid #F5F4EF",paddingTop:10}}>{a}</div>}
        </div>
      ))}
    </div>
  );
}
