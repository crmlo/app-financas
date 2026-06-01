import { useState } from "react"
import { supabase } from "../lib/supabase"

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
      .btn-y{background:#FFD000;color:#000;border:none;border-radius:12px;padding:15px 20px;font-size:14px;font-weight:900;cursor:pointer;width:100%;transition:opacity .15s}
      .btn-y:hover{opacity:.85}
      .btn-y:disabled{opacity:.4;cursor:not-allowed}
      .btn-out{background:transparent;color:#000;border:2px solid #E8E8E8;border-radius:12px;padding:13px 16px;font-size:13px;font-weight:700;cursor:pointer;width:100%}
      .seg{display:flex;border:2px solid #E8E8E8;border-radius:12px;overflow:hidden;background:#F5F4EF}
      .sb{flex:1;background:transparent;border:none;color:#999;font-size:12px;font-weight:700;padding:11px 6px;cursor:pointer;transition:all .15s}
      .sb.on{background:#000;color:#FFD000}
    `}</style>
  )
}

export default function Auth({ onAuth }) {
  const [mode, setMode] = useState("login") // login | register | family
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [name, setName] = useState("")
  const [familyName, setFamilyName] = useState("")
  const [inviteCode, setInviteCode] = useState("")
  const [familyMode, setFamilyMode] = useState("create") // create | join
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [pendingUser, setPendingUser] = useState(null)

  const handleLogin = async () => {
    if (!email || !password) return
    setLoading(true)
    setError("")
    const { data, error: err } = await supabase.auth.signInWithPassword({ email, password })
    if (err) { setError(err.message); setLoading(false); return }
    // Check if user already has a profile with a family
    const { data: profile } = await supabase
      .from("profiles")
      .select("*, families(*)")
      .eq("id", data.user.id)
      .single()
    if (profile?.family_id) {
      onAuth(data.user, profile)
    } else {
      setPendingUser(data.user)
      setMode("family")
    }
    setLoading(false)
  }

  const handleRegister = async () => {
    if (!email || !password || !name) return
    setLoading(true)
    setError("")
    const { data, error: err } = await supabase.auth.signUp({ email, password })
    if (err) { setError(err.message); setLoading(false); return }
    // Create profile without family yet
    await supabase.from("profiles").insert({ id: data.user.id, name, role: "master" })
    setPendingUser(data.user)
    setMode("family")
    setLoading(false)
  }

  const handleFamily = async () => {
    const user = pendingUser
    if (!user) return
    setLoading(true)
    setError("")

    if (familyMode === "create") {
      if (!familyName) { setError("Digite o nome da família"); setLoading(false); return }
      const code = "FAM-" + Math.random().toString(36).substr(2, 5).toUpperCase()
      const { data: fam, error: famErr } = await supabase
        .from("families")
        .insert({ name: familyName, invite_code: code })
        .select()
        .single()
      if (famErr) { setError(famErr.message); setLoading(false); return }
      await supabase.from("profiles").update({ family_id: fam.id, role: "master" }).eq("id", user.id)
      // Create initial empty app_data row for this family
      await supabase.from("app_data").insert({ family_id: fam.id, data: null })
      const { data: profile } = await supabase.from("profiles").select("*, families(*)").eq("id", user.id).single()
      onAuth(user, profile)
    } else {
      if (!inviteCode) { setError("Digite o código de convite"); setLoading(false); return }
      const { data: fam, error: famErr } = await supabase
        .from("families")
        .select()
        .eq("invite_code", inviteCode.toUpperCase().trim())
        .single()
      if (famErr || !fam) { setError("Código de convite inválido"); setLoading(false); return }
      await supabase.from("profiles").update({ family_id: fam.id, role: "member" }).eq("id", user.id)
      const { data: profile } = await supabase.from("profiles").select("*, families(*)").eq("id", user.id).single()
      onAuth(user, profile)
    }
    setLoading(false)
  }

  if (mode === "family") {
    return (
      <div style={{ minHeight: "100vh", background: "#F5F4EF", display: "flex", flexDirection: "column" }}>
        <GS />
        <div style={{ background: "#FFD000", padding: "40px 24px 28px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 3, color: "rgba(0,0,0,.4)", textTransform: "uppercase", marginBottom: 8 }}>Quase lá!</div>
          <div style={{ fontSize: 28, fontWeight: 900, color: "#000", lineHeight: 1.1 }}>Sua família financeira</div>
        </div>
        <div style={{ flex: 1, padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="seg">
            <button className={"sb" + (familyMode === "create" ? " on" : "")} onClick={() => setFamilyMode("create")}>Criar família</button>
            <button className={"sb" + (familyMode === "join" ? " on" : "")} onClick={() => setFamilyMode("join")}>Entrar com código</button>
          </div>
          {familyMode === "create" ? <>
            <p style={{ fontSize: 14, color: "#666", lineHeight: 1.6 }}>Crie sua família e compartilhe o código com quem quiser dar acesso.</p>
            <input className="inp" placeholder="Nome da família (ex: Família Silva)" value={familyName} onChange={e => setFamilyName(e.target.value)} />
          </> : <>
            <p style={{ fontSize: 14, color: "#666", lineHeight: 1.6 }}>Digite o código de convite que o master da família compartilhou com você.</p>
            <input className="inp" placeholder="Código (ex: FAM-AB12C)" value={inviteCode} onChange={e => setInviteCode(e.target.value)} style={{ textTransform: "uppercase", letterSpacing: 2, fontWeight: 900, fontSize: 18 }} />
          </>}
          {error && <div style={{ fontSize: 13, color: "#E85D4A", background: "#FEF2F2", borderRadius: 10, padding: "10px 12px" }}>{error}</div>}
          <button className="btn-y" onClick={handleFamily} disabled={loading}>
            {loading ? "Aguarde..." : familyMode === "create" ? "Criar família →" : "Entrar na família →"}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: "100vh", background: "#F5F4EF", display: "flex", flexDirection: "column" }}>
      <GS />
      <div style={{ background: "#FFD000", padding: "60px 24px 32px" }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 3, color: "rgba(0,0,0,.4)", textTransform: "uppercase", marginBottom: 12 }}>Família Finance</div>
        <div style={{ fontSize: 34, fontWeight: 900, color: "#000", lineHeight: 1.1 }}>{mode === "login" ? "Bem-vindo de volta 👋" : "Criar conta 🚀"}</div>
      </div>
      <div style={{ flex: 1, padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="seg">
          <button className={"sb" + (mode === "login" ? " on" : "")} onClick={() => { setMode("login"); setError("") }}>Entrar</button>
          <button className={"sb" + (mode === "register" ? " on" : "")} onClick={() => { setMode("register"); setError("") }}>Criar conta</button>
        </div>
        {mode === "register" && (
          <input className="inp" placeholder="Seu nome" value={name} onChange={e => setName(e.target.value)} />
        )}
        <input className="inp" placeholder="E-mail" type="email" value={email} onChange={e => setEmail(e.target.value)} inputMode="email" autoCapitalize="none" />
        <input className="inp" placeholder="Senha" type="password" value={password} onChange={e => setPassword(e.target.value)} />
        {error && <div style={{ fontSize: 13, color: "#E85D4A", background: "#FEF2F2", borderRadius: 10, padding: "10px 12px" }}>{error}</div>}
        <button className="btn-y" onClick={mode === "login" ? handleLogin : handleRegister} disabled={loading}>
          {loading ? "Aguarde..." : mode === "login" ? "Entrar →" : "Criar conta →"}
        </button>
        {mode === "login" && (
          <div style={{ fontSize: 12, color: "#999", textAlign: "center", lineHeight: 1.6 }}>
            Primeira vez? Clique em "Criar conta" acima.
          </div>
        )}
      </div>
    </div>
  )
}
