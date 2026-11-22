/* Ano Novo 26/27: cardápio -> receitas -> ingredientes -> lista de compras.
   A lista de compras nunca é guardada: é sempre calculada a partir do cardápio. */
(() => {
  const CFG = window.APP_CONFIG || {};
  let who = "";
  const TABLES = ["ingredients", "recipes", "recipe_items", "days", "menu", "pendencias", "extras", "people", "activities", "trash", "comments", "private"];
  const OPTIONAL = new Set(["people", "activities", "trash", "comments", "private"]);
  const TABS = ["start", "menu", "recipes", "home", "fun", "shop", "take", "mine", "pend", "cfg", "help"];
  const SEC = { start: "inicio", menu: "plano", recipes: "plano", home: "plano", fun: "plano", shop: "compras", take: "levar", mine: "minha", pend: "pend", cfg: "cfg", help: "cfg" };
  const TITLE = { start: "Início", menu: "Cardápio", recipes: "Receitas", home: "Casa", fun: "Entretenimento", shop: "Compras", take: "Levar", mine: "Minha lista", pend: "Pendências", cfg: "Ajustes", help: "Como funciona" };
  const PREFIX = "an_";
  const LS_KEY = "ano-novo-2627";
  const VEG = "Opção vegetariana";
  const SIDE = "Acompanhamento";   // entra por dia, junto do prato principal
  const BLOCKS = ["Jantar", VEG, SIDE, "Café da manhã", "Snacks", "Sobremesa", "Bebidas", "Casa"];
  const FOOD = BLOCKS.filter(b => b !== "Casa");
  const WHEN = ["Black Friday (27/11)", "Antes da viagem", "Lá, durante a semana", "A definir"];
  // nomes antigos, para os dados que ainda não foram renomeados no banco
  const WHEN_OLD = { "Antecipado, se congelar": "Antes da viagem", "Semana da viagem (até 26/12)": "Antes da viagem", "Compra à parte": "Antes da viagem", "Fresco / repor lá": "Lá, durante a semana", "A confirmar": "A definir" };
  const SEC_OLD = { "Mercado": "Mercearia", "Açougue / Peixaria": "Açougue e peixaria", "Casa": "Casa e descartáveis", "Feira": "Hortifruti" };
  // Black Friday é uma marcação por cima do momento real: até BF_UNTIL o item aparece no grupo da Black Friday, depois volta para o momento dele
  const BF = WHEN[0], BF_UNTIL = "2026-11-30";
  const bfCol = () => !client || !S.ingredients[0] || "bf" in S.ingredients[0];
  const bfLive = () => new Date().toLocaleDateString("sv") <= BF_UNTIL;
  const realWhen = i => { const w = WHEN_OLD[i.when_buy] || i.when_buy || ""; return bfCol() && w === BF ? "Antes da viagem" : w; };
  const isBF = i => bfCol() ? !!i.bf || i.when_buy === BF : i.when_buy === BF;
  const whenOf = i => bfCol() ? (isBF(i) && bfLive() ? BF : realWhen(i)) : (WHEN_OLD[i.when_buy] || i.when_buy || "");
  const secOf = i => SEC_OLD[i.sector] || i.sector || "";
  const isFreeze = i => !!i.can_freeze || i.when_buy === "Antecipado, se congelar";
  const SECTORS = ["Mercearia", "Hortifruti", "Frios e laticínios", "Açougue e peixaria", "Padaria", "Bebidas", "Congelados", "Casa e descartáveis"];

  const HOME = "Alguém leva pronto";
  const isHome = i => !!i.from_home || i.when_buy === HOME;
  const isAtHouse = i => !!i.at_house;   // já existe na casa alugada: não entra em compras nem em levar
  const hasHouse = () => !client || !S.ingredients[0] || "at_house" in S.ingredients[0];
  // um campo só: comprar (e quando), alguém leva, ou já tem na casa
  const planSel = i => { const buy = !isHome(i) && !isAtHouse(i), w = realWhen(i) || "A definir";
    return `<label class="fld wide">Comprar ou levar<select data-act="plan" data-id="${i.id}">
    ${[...new Set(WHEN.slice(bfCol() ? 1 : 0).concat(buy ? w : []))].map(x => `<option value="w:${esc(x)}" ${buy && x === w ? "selected" : ""}>Comprar: ${esc(x.toLowerCase())}</option>`).join("")}
    <option value="take" ${isHome(i) && !isAtHouse(i) ? "selected" : ""}>Responsável leva de casa</option>
    ${hasHouse() ? `<option value="house" ${isAtHouse(i) ? "selected" : ""}>Já tem na casa</option>` : ""}</select></label>
    ${buy && bfCol() && (bfLive() || isBF(i)) ? `<div class="fld wide">${chk("ingredients", i.id, "bf", isBF(i), "Tentar comprar na Black Friday (27/11)")}</div>` : ""}
    ${isHome(i) && !isAtHouse(i) && !i.owner ? `<p class="err wide">Falta definir quem leva.</p>` : ""}`; };
  const S = Object.fromEntries(TABLES.map(t => [t, []]));
  const ui = { tab: localStorage.getItem("an-tab") || "start", open: new Set(), group: "when_buy", fWho: "", fStatus: "", fRev: "", fSector: "", fStore: "", fWhen: "", fType: "", tWho: "", tStatus: "", mStatus: "", mSector: "", pStatus: "todo", pRec: "", rq: "", rBlock: "", rIn: "", rRev: "", q: "", me: "", menuView: localStorage.getItem("an-menu-view") || "list" };
  if (!TABS.includes(ui.tab)) ui.tab = "start";
  let client = null, renderPending = false, needsSetup = false, noTrash = false, noComments = false, noPrivate = false, revMap = new Map();

  const $ = s => document.querySelector(s);
  const view = $("#view");
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const uid = () => crypto.randomUUID();
  const nf = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
  const get = (t, id) => S[t].find(r => r.id === id);
  const byPos = (a, b) => (a.pos ?? 0) - (b.pos ?? 0);
  const nextPos = t => S[t].reduce((m, r) => Math.max(m, r.pos ?? 0), 0) + 1;

  function toast(msg, undoId) {
    const el = $("#toast"); el.textContent = msg;
    if (undoId) el.insertAdjacentHTML("beforeend", ` <button class="link" data-act="restore" data-id="${undoId}">Desfazer</button>`);
    el.classList.add("on");
    clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove("on"), undoId ? 8000 : 3800);
  }
  // a coluna existe no banco? (permite publicar o site antes de atualizar o banco)
  const hasCol = (t, c) => !client || !S[t][0] || c in S[t][0];

  /* ---------- persistência ---------- */
  function saveLocal() { if (!client) localStorage.setItem(LS_KEY, JSON.stringify(S)); }
  /* Fila de gravação: cada alteração vira um trabalho pequeno, só com o campo que mudou.
     Sem conexão, a fila fica guardada no aparelho e é reenviada sozinha. */
  const QKEY = "an-queue";
  let queue = []; try { queue = JSON.parse(localStorage.getItem(QKEY)) || []; } catch { queue = []; }
  let busy = false, current = Promise.resolve();
  function saved() {
    const el = $("#sync"); if (!el) return;
    el.hidden = false; el.classList.add("ok"); el.textContent = "Salvo";
    clearTimeout(saved.t); saved.t = setTimeout(() => { el.classList.remove("ok"); syncBadge(); }, 1300);
  }
  function syncBadge() {
    const el = $("#sync"); if (!el) return;
    if (queue.length) el.classList.remove("ok"); else if (el.classList.contains("ok")) return;
    el.hidden = !queue.length;
    el.textContent = queue.length === 1 ? "1 alteração guardada, aguardando conexão" : `${queue.length} alterações guardadas, aguardando conexão`;
  }
  const saveQueue = () => { localStorage.setItem(QKEY, JSON.stringify(queue)); syncBadge(); };
  function enqueue(job) { if (!client) { saveLocal(); return Promise.resolve(); } queue.push(job); saveQueue(); return flush(); }
  function flush() {
    if (!client) return Promise.resolve();
    if (busy) return current;
    busy = true;
    current = (async () => {
      let sent = 0;
      try { while (queue.length) {
        const j = queue[0]; let error = null;
        try {
          const q = client.from(PREFIX + j.table);
          ({ error } = j.op === "put" ? await q.upsert(j.data) : j.op === "patch" ? await q.update(j.data).eq("id", j.id) : await q.delete().eq("id", j.id));
        } catch (e) { error = e; }
        if (error) {
          if (!navigator.onLine || /fetch|network|load failed/i.test(String(error.message || error))) break;
          console.error(error); toast("Uma alteração foi recusada pelo banco e não foi salva.");
        }
        queue.shift(); saveQueue(); if (!error) sent++;
      } } finally { busy = false; if (sent && !queue.length) saved(); }
    })();
    return current;
  }
  // o que ainda está na fila vale mais do que o que veio do banco
  function applyQueue() {
    for (const j of queue) {
      const t = j.table; if (!S[t]) continue;
      if (j.op === "patch") { const r = get(t, j.id); if (r) Object.assign(r, j.data); }
      else if (j.op === "put") { const r = get(t, j.data.id); r ? Object.assign(r, j.data) : S[t].push(j.data); }
      else removeLocal(t, j.id);
    }
  }
  const persist = (table, row) => enqueue({ op: "put", table, data: row });
  const persistPatch = (table, id, data) => enqueue({ op: "patch", table, id, data });
  const persistDelete = (table, id) => enqueue({ op: "del", table, id });
  function update(table, id, patch, force) {
    const row = get(table, id); if (!row) return;
    Object.assign(row, patch); persistPatch(table, id, patch); render(force);
  }
  function add(table, row, force = true) { S[table].push(row); persist(table, row); render(force); return row; }
  function removeLocal(table, id) { const i = S[table].findIndex(r => r.id === id); if (i >= 0) S[table].splice(i, 1); }
  const KIND = { recipes: "Receita", ingredients: "Ingrediente", activities: "Atividade", extras: "Item", pendencias: "Pendência", recipe_items: "Ingrediente de receita", comments: "Comentário", people: "Pessoa" };
  function remove(table, id) {
    const row = get(table, id); if (!row) return;
    const pay = { [table]: [row] };
    if (table === "recipes") { pay.recipe_items = S.recipe_items.filter(r => r.recipe_id === id); pay.menu = S.menu.filter(r => r.recipe_id === id); pay.pendencias = S.pendencias.filter(r => r.recipe_id === id); }
    // a conversa vai junto: o banco apaga os comentários em cascata
    const pids = new Set((table === "pendencias" ? [row] : pay.pendencias || []).map(p => p.id)); if (pids.size) pay.comments = S.comments.filter(c => pids.has(c.pend_id));
    if (table === "ingredients") pay.recipe_items = S.recipe_items.filter(r => r.ingredient_id === id);
    if (table === "activities") pay.extras = S.extras.filter(r => r.activity_id === id);
    let label = row.name || row.item || row.subject || (row.body ? `Comentário: ${String(row.body).slice(0, 40)}` : "");
    if (table === "recipe_items") label = `${(get("ingredients", row.ingredient_id) || {}).name || "Item"} em ${(get("recipes", row.recipe_id) || {}).name || "receita"}`;
    const keep = KIND[table] && !noTrash;
    let tid = null;
    if (keep) { const t = { id: uid(), tbl: table, label, payload: pay, deleted_by: who, deleted_at: new Date().toISOString() }; S.trash.push(t); persist("trash", t); tid = t.id; }
    for (const [t, rows] of Object.entries(pay)) rows.forEach(r => removeLocal(t, r.id));
    persistDelete(table, id); render(true);
    if (keep) toast(`${label} foi para a lixeira.`, tid);
  }
  async function restore(id) {
    const t = get("trash", id); if (!t) return;
    const ok = { recipe_items: r => get("recipes", r.recipe_id) && get("ingredients", r.ingredient_id), menu: r => get("recipes", r.recipe_id) && get("days", r.day_id), comments: r => get("pendencias", r.pend_id) };
    let skipped = 0;
    for (const tb of ["people", "ingredients", "recipes", "activities", "recipe_items", "menu", "extras", "pendencias", "comments"]) for (const r of (t.payload[tb] || [])) {
      if (ok[tb] && !ok[tb](r)) { skipped++; continue; }
      if (tb === "extras" && r.activity_id && !get("activities", r.activity_id)) r.activity_id = null;
      if (tb === "pendencias" && r.recipe_id && !get("recipes", r.recipe_id)) r.recipe_id = null;
      if (!get(tb, r.id)) S[tb].push(r);
      await persist(tb, r);
    }
    removeLocal("trash", id); persistDelete("trash", id); render(true);
    toast(skipped ? `${t.label} voltou, menos ${skipped} ligações com coisas que não existem mais.` : `${t.label} voltou.`);
  }

  async function fetchAll() {
    const res = await Promise.all(TABLES.map(t => client.from(PREFIX + t).select("*")));
    res.forEach((r, i) => {
      const t = TABLES[i];
      if (!r.error) S[t] = r.data;
      else if (OPTIONAL.has(t)) { needsSetup = true; S[t] = []; if (t === "trash") noTrash = true; if (t === "comments") noComments = true; if (t === "private") noPrivate = true; }
      else throw r.error;
    });
    const has = (t, c) => !S[t][0] || c in S[t][0];
    if (!has("recipes", "reviewed") || !has("ingredients", "paid") || !has("extras", "store") || !has("ingredients", "bought_by") || !has("ingredients", "can_freeze") || !has("recipes", "brought") || !has("recipe_items", "checked_by") || !has("ingredients", "bf") || !has("ingredients", "at_house") || !has("recipe_items", "kind")) needsSetup = true;
    applyQueue();
  }
  // ao voltar para o site: envia o que ficou na fila e busca o que os outros mudaram
  async function refresh() {
    if (!client) return;
    await flush();
    try { needsSetup = noTrash = noComments = noPrivate = false; await fetchAll(); render(false); } catch (e) { console.error(e); }
  }
  async function loadAll() {
    if (client) {
      await flush();
      await fetchAll();
      client.channel("an-all").on("postgres_changes", { event: "*", schema: "public" }, p => {
        const t = p.table.startsWith(PREFIX) ? p.table.slice(PREFIX.length) : null;
        if (!t || !S[t]) return;
        if (p.eventType === "DELETE") removeLocal(t, p.old.id);
        else { const cur = get(t, p.new.id); cur ? Object.assign(cur, p.new) : S[t].push(p.new); }
        render(false);
      }).subscribe();
    } else {
      let data = null;
      try { data = JSON.parse(localStorage.getItem(LS_KEY)); } catch { /* recomeça do zero */ }
      if (!data) { try { const r = await fetch("private/seed.json"); if (r.ok) data = await r.json(); } catch { /* sem dados iniciais */ } }
      if (data) TABLES.forEach(t => { S[t] = data[t] || []; });
      // dados antigos: cada gincana era uma linha solta; agora é uma atividade com itens
      S.extras.filter(e => e.grp === "Gincanas").forEach(e => S.activities.push({ id: e.id, name: e.item, notes: "", pos: e.pos }));
      S.extras = S.extras.filter(e => e.grp !== "Gincanas");
      saveLocal();
    }
  }

  /* ---------- cálculo ---------- */
  const CAFE = "Café da manhã";
  function recipeCount(r) {
    if (r.block === CAFE) return S.days.some(d => d.breakfast) ? 1 : 0;
    return (r.weekly ? 1 : 0) + S.menu.filter(m => m.recipe_id === r.id).length;
  }
  function dayLabel(d, long) {
    const [y, m, dd] = d.date.split("-").map(Number);
    const wk = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"][new Date(y, m - 1, dd).getDay()];
    return long ? { wk, dd, mon: ["", "jan", "", "", "", "", "", "", "", "", "", "", "dez"][m] || m } : `${wk} ${String(dd).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
  }
  function recipeStatus(r) {
    const ds = S.menu.filter(m => m.recipe_id === r.id).map(m => get("days", m.day_id)).filter(Boolean)
      .sort((a, b) => a.date.localeCompare(b.date)).map(d => dayLabel(d));
    if (r.block === CAFE) { const n = S.days.filter(d => d.breakfast).length; return n ? { text: `${n} ${n === 1 ? "dia" : "dias"} com café`, idea: false } : { text: "nenhum dia com café marcado", idea: true }; }
    if (r.weekly) ds.unshift("semana toda");
    if (r.brought && ds.length) ds.push("levada pronta");
    return ds.length ? { text: ds.join(", "), idea: false } : { text: "ideia, fora das compras", idea: true };
  }
  function shopping() {
    const counts = new Map(S.recipes.map(r => [r.id, r.brought ? 0 : recipeCount(r)]));
    const tot = new Map();
    for (const it of S.recipe_items) {
      const c = counts.get(it.recipe_id) || 0; if (!c) continue;
      const e = tot.get(it.ingredient_id) || { qty: 0, uses: [] };
      e.qty += (Number(it.qty) || 0) * c;
      const r = get("recipes", it.recipe_id);
      e.uses.push({ id: r.id, name: r.name, qty: it.qty, times: c });
      tot.set(it.ingredient_id, e);
    }
    return tot;
  }
  // Conferência: cada linha de receita guarda quem conferiu (checked_by). A receita está conferida quando todas as linhas estão.
  const CK = () => hasCol("recipe_items", "checked_by");
  const checkers = it => String(it.checked_by || "").split(",").map(x => x.trim()).filter(Boolean);
  const isChk = it => checkers(it).length > 0;
  const isRev = r => { if (!CK()) return !!r.reviewed; if (r.brought) return true; const l = S.recipe_items.filter(i => i.recipe_id === r.id); return l.length > 0 && l.every(isChk); };
  const LEAF = `<svg class="leaf" viewBox="0 0 24 24" role="img" aria-label="opção vegetariana"><path d="M5 19c0-8 5-13 14-14 0 9-5 14-13 14M5 19l7-7"/></svg>`;
  const LEAF_H = LEAF.replace('role="img" aria-label="opção vegetariana"', 'aria-hidden="true"');
  const vegRows = r => S.recipe_items.filter(i => i.recipe_id === r.id && i.veg === "sim").sort(byPos);
  const vegItems = r => vegRows(r).map(i => (get("ingredients", i.ingredient_id) || {}).name).filter(Boolean);
  const dayRecs = d => S.menu.filter(m => m.day_id === d.id).sort(byPos).map(m => get("recipes", m.recipe_id)).filter(Boolean);
  // o que a pessoa vegetariana come no dia: receitas à parte e ingredientes com folha
  const dayVeg = d => dayRecs(d).flatMap(r => r.block === VEG ? [r.name] : vegItems(r)).join(", ");
  // "ok" = tem alternativa e ela está conferida; "pend" = tem, mas falta conferir; "miss" = não tem
  const dayVegState = d => { const rs = dayRecs(d), any = rs.some(r => r.block === VEG || vegRows(r).length);
    if (!any) return "miss"; if (!CK()) return "ok";
    return rs.some(r => r.block === VEG ? isRev(r) : vegRows(r).some(isChk)) ? "ok" : "pend"; };
  const vegTag = d => { const st = dayVegState(d); return st === "miss" ? `<span class="tag sug">falta opção vegetariana</span>` : `<span class="vegline ${st}">${LEAF}<span>${esc(dayVeg(d))}${st === "pend" ? " (a conferir)" : ""}</span></span>`; };
  // ingrediente -> receitas do cardápio que usam ele e ainda não foram conferidas
  function unreviewed() {
    const m = new Map();
    for (const it of S.recipe_items) {
      const r = get("recipes", it.recipe_id);
      if (!r || r.brought || r.block === "Casa" || !recipeCount(r) || (CK() ? isChk(it) : r.reviewed)) continue;
      const l = m.get(it.ingredient_id) || []; if (!l.includes(r.name)) l.push(r.name); m.set(it.ingredient_id, l);
    }
    return m;
  }
  const NOPL = new Set(["un", "g", "kg", "l", "ml", "cm"]);
  function unitPl(u, q) {
    if (!(q >= 2) || !u) return u;
    const [w, ...rest] = String(u).split(" ");
    if (NOPL.has(w.toLowerCase()) || /s$/i.test(w)) return u;
    const p = /[rz]$/i.test(w) ? w + "es" : /[aeiouáéíóúãõâêô]$/i.test(w) ? w + "s" : w;
    return [p, ...rest].join(" ");
  }
  // gramas (ou ml) por xícara, só para o que tem medida conhecida
  const DENS = [[/farinha/, 120], [/acucar mascavo/, 180], [/acucar de confeiteiro/, 120], [/acucar/, 200], [/manteiga|margarina/, 225], [/amido|maisena/, 120],
    [/chocolate em po|cacau/, 90], [/aveia/, 90], [/arroz/, 185], [/leite condensado/, 300], [/leite|agua|creme de leite|oleo|azeite/, 240], [/mel/, 340],
    [/queijo ralado|parmesao/, 100], [/gotas de chocolate|chocolate/, 170]];
  const dens = ing => (ing && /^(g|ml)$/i.test(ing.unit || "") && (DENS.find(([re]) => re.test(norm(ing.name))) || [])[1]) || 0;
  // "2 xícaras" ou "3 colheres de sopa" de um ingrediente com medida conhecida viram g ou ml
  const cupUnit = u => { const k = norm(u); return /^(xic|xicara|xicaras|xic\.|cup|cups)$/.test(k) ? 1 : /^(cs|colher|colheres|colher de sopa|colheres de sopa|c\. sopa|c sopa)$/.test(k) ? 1 / 16 : 0; };
  const densByName = name => (DENS.find(([re]) => re.test(norm(name))) || [])[1] || 0;
  const isLiquid = name => /leite|agua|creme de leite|oleo|azeite|suco|caldo|vinho/.test(norm(name)) && !/condensado|em po/.test(norm(name));
  const unit0 = (cu, n) => cu === 1 ? (n <= 1 ? "xícara" : "xícaras") : (n <= 1 ? "colher de sopa" : "colheres de sopa");
  function cups(ing, qty) {
    const d = dens(ing); if (!d || !qty) return "";
    const n = qty / d;
    if (n < 0.2) { const c = Math.round(n * 16); return c ? `cerca de ${c} ${c === 1 ? "colher de sopa" : "colheres de sopa"}` : ""; }
    const q = Math.round(n * 4) / 4, w = Math.floor(q), f = { 0.25: "1/4", 0.5: "1/2", 0.75: "3/4" }[q - w] || "";
    return `cerca de ${[w || "", f].filter(Boolean).join(" ")} ${q <= 1 ? "xícara" : "xícaras"}`;
  }
  function fmtQty(q, u) {
    if (!q) return "a definir";
    if (u === "g" && q >= 1000) return nf.format(q / 1000) + " kg";
    if (u === "ml" && q >= 1000) return nf.format(q / 1000) + " L";
    return nf.format(q) + " " + unitPl(u, q);
  }
  function findIng(name) { const k = norm(name); return S.ingredients.find(i => norm(i.name) === k); }

  function onScroll() {
    const on = window.scrollY > (ui.tab === "start" ? 240 : 56);
    document.body.classList.toggle("scrolled", on);
  }
  window.addEventListener("scroll", onScroll, { passive: true });

  /* ---------- render ---------- */
  // rascunho = texto digitado num formulário que ainda não foi enviado (ou numa busca): sobrevive ao redesenho da tela
  let noDraft = false;   // ligado por go(): ao trocar de aba, o que estava digitado na aba anterior não vai junto
  const draftKey = el => { const f = el.closest("form[data-form]"); return f ? [ui.tab, f.dataset.form, f.dataset.buy || "", f.dataset.id || f.dataset.pend || f.dataset.item || f.dataset.recipe || f.dataset.activity || "", el.name].join("|") : el.id || ""; };
  const draftEls = () => [...view.querySelectorAll("form[data-form]:not([data-sent]) input[name], form[data-form]:not([data-sent]) textarea[name], form[data-form]:not([data-sent]) select[name], #pend-q")].filter(el => el.type !== "checkbox" && el.type !== "file" && draftKey(el));
  function render(force) {
    const a = document.activeElement;
    if (!force && a && view.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== "checkbox") { renderPending = true; return; }
    const dflt = el => el.tagName === "SELECT" ? (el.options[0] || {}).value : el.defaultValue;
    const drafts = noDraft ? new Map() : new Map(draftEls().filter(el => el.value && el.value !== dflt(el)).map(el => [draftKey(el), el.value]));
    noDraft = false;
    renderPending = false;
    const sec = SEC[ui.tab];
    $("#app").dataset.sec = sec;
    document.querySelectorAll("#tabs button").forEach(b => b.setAttribute("aria-current", b.dataset.sec === sec ? "page" : "false"));
    { const n = S.pendencias.filter(tagsMe).length, b = document.querySelector('#tabs [data-tab="pend"]'); if (b) { b.classList.toggle("badge", n > 0); b.dataset.n = n || ""; } }
    $("#sub").hidden = sec !== "plano";
    $("#top").hidden = ui.tab === "start";
    document.querySelectorAll("#sub button").forEach(b => b.setAttribute("aria-current", b.dataset.tab === ui.tab ? "page" : "false"));
    const y = window.scrollY, shOld = view.querySelector(".sheet"), shY = shOld ? shOld.scrollTop : 0;
    revMap = unreviewed(); bulk.clear();
    view.innerHTML = (needsSetup ? `<p class="warn">Parte das novidades só salva depois que o banco for atualizado: rode, em ordem, os arquivos supabase/migration-02.sql a migration-10.sql que ainda não rodou.</p>` : "") +
      ({ cfg: vCfg, start: vStart, menu: vMenu, recipes: vRecipes, home: vHome, shop: vShop, take: vTake, fun: vFun, pend: vPend, mine: vMine, help: vHelp }[ui.tab])();
    window.scrollTo(0, y);
    const shNew = view.querySelector(".sheet"); if (shNew) shNew.scrollTop = shY;
    document.body.classList.toggle("locked", !!shNew);
    markScroll();
    if (drafts.size) draftEls().forEach(el => { const v = drafts.get(draftKey(el)); if (v !== undefined && el.value === dflt(el)) { el.value = v; if (el.name === "sector") el.dataset.touched = "1"; if (el.id === "pend-q" || el.dataset.act === "ing-hint") el.dispatchEvent(new Event("input", { bubbles: true })); } });
    view.querySelectorAll("input[placeholder]:not([aria-label])").forEach(i => { if (!i.closest("label")) i.setAttribute("aria-label", i.placeholder); });
    $("#top").innerHTML = ui.tab === "start" ? "" : header();
    const hs = ui.tab === "start" ? null : headStat(shopping());
    $("#mini").innerHTML = ui.tab === "start" ? `<strong>Ano Novo 26/27</strong>` : hs ? `<button class="link home" data-go="start" aria-label="Ir para o início"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11.5 12 4l8 7.5V20h-5v-5H9v5H4z"/></svg></button><strong>${TITLE[ui.tab]}</strong>${hs.n ? `<span>${hs.d} de ${hs.n}</span>` : ""}<i style="width:${hs.n ? Math.round(100 * hs.d / hs.n) : 0}%"></i>` : "";
    onScroll();
    if (ui.tab === "shop" && ui.q) filterShop();
    if (ui.tab === "recipes" && ui.rq) filterRecipes();
    syncHistory();
  }
  // Botão "voltar" do celular: cada troca de tela (aba, receita aberta, janela do dia ou de filtros) vira um passo no histórico
  const navSnap = () => JSON.stringify({ t: ui.tab, r: ui.rec || null, s: ui.sheet || null, f: !!ui.fsheet, b: ui.back || null });
  let navCur = null, navY = 0;
  function syncHistory() {
    const s = navSnap();
    try {
      if (navCur === null) { history.replaceState({ nav: s, y: 0 }, ""); navCur = s; return; }
      if (s === navCur) return;
      history.replaceState({ nav: navCur, y: navY }, "");   // guarda onde a tela anterior estava rolada
      history.pushState({ nav: s, y: 0 }, ""); navCur = s;
    } catch { navCur = s; }
  }
  window.addEventListener("scroll", () => { navY = window.scrollY; }, { passive: true });
  window.addEventListener("popstate", e => {
    const st = e.state; if (!st || !st.nav) return;
    let o; try { o = JSON.parse(st.nav); } catch { return; }
    if (!TABS.includes(o.t)) return;
    ui.tab = o.t; ui.rec = o.r && get("recipes", o.r) ? o.r : null; ui.sheet = o.s && get("days", o.s) ? o.s : null; ui.fsheet = !!o.f; ui.back = o.b || null;
    ui.open.delete("acct"); localStorage.setItem("an-tab", ui.tab);
    navCur = navSnap(); noDraft = true;
    render(true);
    const y = st.y || 0; requestAnimationFrame(() => window.scrollTo(0, y));
  });
  const meName = () => { const names = peopleNames(); return ui.me || names.find(n => norm(n) === norm(who)) || who || names[0] || ""; };
  function headStat(tot) {
    const c = (l, f) => l.filter(f).length, t = ui.tab;
    if (t === "shop") { const l = buyEntries(tot), d = c(l, isDone); return { d, n: l.length, text: `${d} de ${l.length} itens comprados.` }; }
    if (t === "take") { const l = takeEntries(tot), d = c(l, isDone); return { d, n: l.length, text: `${d} de ${l.length} itens separados.` }; }
    if (t === "mine") { const me = meName(), l = [...buyEntries(tot), ...takeEntries(tot)].filter(en => isMine(en.r.owner, me)), d = c(l, isDone); return { d, n: l.length, text: me ? `${d} de ${l.length} itens de ${me} resolvidos.` : "Cadastre as pessoas do grupo." }; }
    if (t === "cfg") return { d: 0, n: 0, text: "Pessoas do grupo, cópia de segurança, lixeira e saída." };
    if (t === "help") return { d: 0, n: 0, text: "O que fazer aqui e o que cada sinal quer dizer." };
    if (t === "pend") { const d = c(S.pendencias, p => p.done); return { d, n: S.pendencias.length, text: `${d} de ${S.pendencias.length} pendências resolvidas.` }; }
    if (t === "recipes") { const l = S.recipes.filter(r => recipeCount(r) && r.block !== "Casa"), d = c(l, isRev); return { d, n: l.length, text: `${d} de ${l.length} receitas do cardápio conferidas.` }; }
    if (t === "home") {
      const ids = new Set(S.recipes.filter(r => r.block === "Casa")), ings = new Set(S.recipe_items.filter(i => ids.has(get("recipes", i.recipe_id))).map(i => i.ingredient_id));
      const a = S.ingredients.filter(i => ings.has(i.id)), b = S.extras.filter(e => !e.activity_id), d = c(a, i => i.bought || isAtHouse(i)) + c(b, e => e.done), n = a.length + b.length;
      return { d, n, text: `${d} de ${n} itens da casa resolvidos.` };
    }
    if (t === "fun") { const l = S.extras.filter(e => e.activity_id), d = c(l, e => e.done); return { d, n: l.length, text: l.length ? `${d} de ${l.length} itens das atividades resolvidos.` : `${S.activities.length} atividades, nenhuma com itens ainda.` }; }
    const days = [...S.days].sort((a, b) => a.date.localeCompare(b.date)), d = c(days, x => S.menu.some(m => m.day_id === x.id));
    let left = "";
    if (days[0]) { const [y, m, dd] = days[0].date.split("-").map(Number), n = Math.ceil((new Date(y, m - 1, dd) - new Date().setHours(0, 0, 0, 0)) / 864e5); if (n > 0) left = n === 1 ? "Falta 1 dia. " : `Faltam ${n} dias. `; }
    return { d, n: days.length, text: `${left}${d} de ${days.length} dias com prato definido.` };
  }
  const initials = n => String(n || "?").trim().split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase();
  function acct() {
    const on = ui.open.has("acct"), name = client ? who : "Local";
    return `<span class="acctbox"><button class="avatar" data-act="open" data-key="acct" aria-haspopup="menu" aria-expanded="${on}" aria-label="Conta de ${esc(name)}"><i>${esc(initials(name))}</i><span>${esc(name)}</span></button>
      ${on ? `<span class="amenu" role="menu"><button role="menuitem" data-go="cfg">Ajustes</button><button role="menuitem" data-go="help">Como funciona</button>${client ? `<button role="menuitem" data-act="logout">Sair</button>` : ""}</span>` : ""}</span>`;
  }
  const HWAVE = `<svg class="hwave" viewBox="0 0 900 30" preserveAspectRatio="none" aria-hidden="true">${[0, 1, 2].map(k => { const y = 6 + k * 9, a = k % 2 ? 5 : -5; return `<path d="M-20 ${y} C 60 ${y + a}, 140 ${y - a}, 220 ${y} S 380 ${y + a}, 460 ${y} S 620 ${y - a}, 700 ${y} S 860 ${y + a}, 940 ${y}"/>`; }).join("")}</svg>`;
  function header() {
    const st = headStat(shopping()), pct = st.n ? Math.round(100 * st.d / st.n) : 0, C = 2 * Math.PI * 19;
    return `<div class="top-in">
      <div class="top-row"><button class="link home" data-go="start" aria-label="Ir para o início"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11.5 12 4l8 7.5V20h-5v-5H9v5H4z"/></svg></button><span class="brand">Ano Novo 26/27</span>${acct()}</div>
      <div class="top-main"><div class="top-t"><h1>${TITLE[ui.tab]}</h1>
        <p class="status" aria-live="polite">${st.n && /^\d+ de \d+ /.test(st.text) ? `<b>${st.d}</b> de ${st.n} ${esc(st.text.replace(/^\d+ de \d+ /, "").replace(/\.$/, ""))}` : esc(st.text.replace(/\.$/, ""))}</p></div>
        ${st.n ? `<svg class="ring" viewBox="0 0 48 48" role="img" aria-label="${pct}% concluído"><circle cx="24" cy="24" r="19"/>${pct ? `<circle class="on" cx="24" cy="24" r="19" stroke-dasharray="${(C * pct / 100).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 24 24)"/>` : ""}<text x="24" y="28.5" text-anchor="middle">${pct}%</text></svg>` : ""}</div>
    </div>${HWAVE}`;
  }
  const tick = (t, id, f, val, label) => `<label class="tick"><input type="checkbox" data-act="set" data-t="${t}" data-id="${id}" data-f="${f}" ${val ? "checked" : ""} aria-label="${esc(label)}"><span></span></label>`;

  const inp = (t, id, f, val, extra = "") => `<input data-act="set" data-t="${t}" data-id="${id}" data-f="${f}" value="${esc(val)}" ${extra}>`;
  const chk = (t, id, f, val, label) => `<label class="chk"><input type="checkbox" data-act="set" data-t="${t}" data-id="${id}" data-f="${f}" ${val ? "checked" : ""}><span>${label}</span></label>`;
  const area = (t, id, f, val, ph) => `<textarea data-act="set" data-t="${t}" data-id="${id}" data-f="${f}" rows="2" placeholder="${esc(ph)}">${esc(val)}</textarea>`;
  /* responsáveis: texto "Todos" ou nomes separados por vírgula */
  const owners = v => String(v || "").split(",").map(x => x.trim()).filter(Boolean);
  const isMine = (v, me) => { const o = owners(v); return !!me && (o.includes("Todos") || o.some(n => norm(n) === norm(me))); };
  const peopleNames = () => [...S.people].sort(byPos).map(p => p.name);
  function pickBtn(id, v) {
    return `<button type="button" class="pickbtn ${v ? "" : "none"}" data-act="open" data-key="own-${id}" aria-expanded="${ui.open.has("own-" + id)}">${esc(v || "Definir responsável")}</button>`;
  }
  function pickPanel(t, id, v) {
    if (!ui.open.has("own-" + id)) return "";
    const cur = owners(v), names = [...new Set([...peopleNames(), ...cur.filter(n => n !== "Todos")])];
    const box = (n, on) => `<label class="chk"><input type="checkbox" data-act="owner" data-t="${t}" data-id="${id}" data-name="${esc(n)}" ${on ? "checked" : ""}><span>${esc(n)}</span></label>`;
    return `<div class="pickpanel">${box("Todos", cur.includes("Todos"))}${names.map(n => box(n, cur.includes(n))).join("")}
      <p class="hint">Falta alguém? Adicione em Ajustes, no alto da tela.</p>
      <button type="button" class="ghost" data-act="open" data-key="own-${id}">Pronto</button></div>`;
  }
  const money = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const numIn = v => v ? nf.format(v).replace(/\./g, "") : "";
  function xRow(e, showAct) {
    const a = showAct && e.activity_id ? get("activities", e.activity_id) : null, open = ui.open.has("x-" + e.id);
    const chips = `${e.owner ? `<span class="tag who">${esc(e.owner)}</span>` : `<span class="tag sug">sem responsável</span>`}${e.buy ? `<span class="tag t-when">precisa comprar</span>` : ""}${a ? `<span class="tag t-act">${esc(a.name)}</span>` : ""}${e.buy && Number(e.paid) ? `<span class="tag ok">R$ ${money.format(Number(e.paid))}</span>` : ""}`;
    return `<li class="xrow ${e.done ? "done" : ""} ${open ? "open" : ""}" data-name="${esc(norm(e.item))}">
      ${tick("extras", e.id, "done", e.done, (e.buy ? "Comprado: " : "Separado: ") + e.item)}
      <button class="xmain" data-act="open" data-key="x-${e.id}" aria-expanded="${open}"><span class="xname">${esc(e.item)}</span><span class="chips">${chips}</span></button>
      ${open ? `<div class="xedit">
        <div class="xline">${inp("extras", e.id, "item", e.item, 'aria-label="Nome do item"')}<button class="x" data-act="del" data-t="extras" data-id="${e.id}" aria-label="Excluir ${esc(e.item)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6"/></svg></button></div>
        <div class="xmeta">${pickBtn(e.id, e.owner)}${chk("extras", e.id, "buy", e.buy, "Precisa comprar")}
        ${e.buy ? `<label class="paid">R$ <input data-act="set" data-t="extras" data-id="${e.id}" data-f="paid" data-num="1" value="${esc(numIn(e.paid))}" inputmode="decimal" placeholder="pago" aria-label="Valor pago"></label>
        ${hasCol("extras", "bought_by") ? `<select class="xstore" data-act="set" data-t="extras" data-id="${e.id}" data-f="bought_by" aria-label="Quem pagou">${payOpts(e.bought_by, "Quem pagou")}</select>` : ""}
        <input class="xstore" data-act="set" data-t="extras" data-id="${e.id}" data-f="store" value="${esc(e.store)}" data-sug="stores" autocomplete="off" placeholder="Loja" aria-label="Loja">` : ""}</div>
        ${pickPanel("extras", e.id, e.owner)}
        <button class="btn sm xclose" data-act="open" data-key="x-${e.id}">Fechar</button></div>` : ""}
    </li>`;
  }

  /* listas: tudo que é comprar vai para Compras, tudo que é levar vai para Levar */
  const GROUPS = { when_buy: "Momento", sector: "Seção", store: "Loja", owner: "Pessoa", type: "Comida ou item" };
  const NONE = { when_buy: "A definir", sector: "Sem seção", store: "Sem loja definida", owner: "Sem responsável" };
  const isDone = en => en.k === "i" ? !!en.r.bought : en.k === "r" ? !!en.r.brought_done : !!en.r.done;
  const nameOf = en => en.k === "x" ? en.r.item : en.r.name;
  const tableOf = en => en.k === "i" ? "ingredients" : en.k === "r" ? "recipes" : "extras";
  const buyEntries = tot => [...S.ingredients.filter(i => tot.has(i.id) && !isHome(i) && !isAtHouse(i)).map(r => ({ k: "i", r })), ...S.extras.filter(e => e.buy).map(r => ({ k: "x", r }))];
  const takeEntries = tot => [...S.ingredients.filter(i => tot.has(i.id) && isHome(i) && !isAtHouse(i)).map(r => ({ k: "i", r })), ...S.extras.filter(e => !e.buy).map(r => ({ k: "x", r })), ...S.recipes.filter(r => r.brought && recipeCount(r)).map(r => ({ k: "r", r }))];
  function keyOf(en, g) {
    if (en.k === "r") return g === "origin" ? "Receitas levadas prontas" : g === "owner" ? (en.r.owner || NONE.owner) : g === "type" ? "Comida" : g === "sector" ? "Receita pronta" : NONE[g];
    if (g === "origin") {
      if (en.k === "i") return "Comida que vem de casa";
      const a = en.r.activity_id && get("activities", en.r.activity_id);
      return a ? "Entretenimento: " + a.name : "Itens de uso geral";
    }
    if (g === "owner") return en.r.owner || NONE.owner;
    if (g === "type") return en.k === "i" ? "Comida" : "Itens";
    if (g === "store") return en.r.store || NONE.store;
    if (en.k === "i") return (g === "when_buy" ? whenOf(en.r) : g === "sector" ? secOf(en.r) : en.r[g]) || NONE[g];
    if (g === "sector") return en.r.activity_id ? "Entretenimento" : "Uso geral";
    return NONE[g];
  }
  function passF(en, f) {
    const o = en.r.owner;
    if (f.who && !(f.who === "-" ? !o : isMine(o, f.who))) return false;
    if (f.status && (f.status === "done") !== isDone(en)) return false;
    if (f.rev && (en.k !== "i" || (f.rev === "ok") === revMap.has(en.r.id))) return false;
    if (f.sector && keyOf(en, "sector") !== f.sector) return false;
    if (f.store && keyOf(en, "store") !== f.store) return false;
    if (f.when && keyOf(en, "when_buy") !== f.when) return false;
    if (f.type && keyOf(en, "type") !== f.type) return false;
    return true;
  }
  function rRow(r) {
    const open = ui.open.has("own-" + r.id);
    return `<li class="xrow rrow ${r.brought_done ? "done" : ""}" data-name="${esc(norm(r.name))}">
      ${tick("recipes", r.id, "brought_done", r.brought_done, "Separado: " + r.name)}
      <div class="xmain static"><button class="xname rlink" data-act="open-recipe" data-id="${r.id}">${esc(r.name)}</button>
        <span class="chips"><button class="tag ${r.owner ? "who" : "sug"} tagpick" data-act="open" data-key="own-${r.id}" aria-expanded="${open}" aria-label="Responsável por ${esc(r.name)}: ${esc(r.owner || "ninguém")}. Trocar">${esc(r.owner || "sem responsável")}</button><span class="tag t-rec">receita pronta</span></span></div>
      ${pickPanel("recipes", r.id, r.owner)}
    </li>`;
  }
  const bulk = new Map(); // chave -> { name, list }, refeito a cada desenho
  function bulkPanel(key) {
    if (!ui.open.has("bulk-" + key)) return "";
    return `<div class="pickpanel bulk"><select aria-label="Responsável"><option>Todos</option>${peopleNames().map(n => `<option>${esc(n)}</option>`).join("")}</select>
      <button class="btn" data-act="bulk-owner" data-key="${esc(key)}" data-mode="empty">Só nos sem responsável</button>
      <button class="btn" data-act="bulk-owner" data-key="${esc(key)}" data-mode="all">Em todos</button></div>`;
  }
  const gtools = (key, label, noBulk) => `<div class="gtools"><button class="ghost" data-act="copy-list" data-key="${esc(key)}">Copiar lista</button>${noBulk ? "" : `<button class="ghost" data-act="open" data-key="bulk-${esc(key)}">${label}</button>`}</div>${noBulk ? "" : bulkPanel(key)}`;
  function groupList(entries, g, tot, tag = "h2", scope = "", defOpen = true) {
    const groups = new Map();
    entries.forEach(en => { const k = keyOf(en, g); (groups.get(k) || groups.set(k, []).get(k)).push(en); });
    const order = [...groups.keys()].sort((a, b) => g === "when_buy" ? ((WHEN.indexOf(a) + 99) % 99) - ((WHEN.indexOf(b) + 99) % 99) : (a === NONE[g]) - (b === NONE[g]) || a.localeCompare(b, "pt"));
    return order.map(k => {
      const own = en => String(en.r.owner || "").trim();
      const l = groups.get(k).sort((a, b) => (isDone(a) - isDone(b)) || (g === "owner" ? 0 : (!own(a) - !own(b)) || own(a).localeCompare(own(b), "pt")) || nameOf(a).localeCompare(nameOf(b), "pt")), d = l.filter(isDone).length;
      const key = `g-${scope}-${g}-${k}`, open = ui.open.has(key) !== defOpen;
      bulk.set(key, { name: k, list: l });
      return `<section class="grp">
        <${tag} class="grp-h"><button class="chev" data-act="open" data-key="${esc(key)}" aria-expanded="${open}">
          <span class="grp-n">${esc(k)}</span><span class="grp-c">${d} de ${l.length}</span><span class="grp-m" aria-hidden="true"><i style="width:${Math.round(100 * d / l.length)}%"></i></span></button></${tag}>
        ${open ? gtools(key, "Definir responsável do grupo", scope === "mb" || scope === "mt") : ""}
        <ul class="shop xlist" data-closed="${open ? 0 : 1}" ${open ? "" : "hidden"}>${l.map(en => en.k === "i" ? vItem(en.r, tot.get(en.r.id), g) : en.k === "r" ? rRow(en.r) : xRow(en.r, g !== "origin")).join("")}</ul>
      </section>`;
    }).join("");
  }
  const pill = (f, label, opts) => `<select class="pill ${ui[f] ? "on" : ""}" data-act="ui" data-f="${f}" aria-label="Filtrar por ${esc(label.toLowerCase())}"><option value="">${esc(label)}</option>${opts.map(([v, l]) => `<option value="${esc(v)}" ${ui[f] === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
  const seg3 = (f, labels) => `<div class="seg" role="group" aria-label="Situação">${[["", labels[0]], ["todo", labels[1]], ["done", labels[2]]].map(([v, l]) => `<button data-act="ui-set" data-f="${f}" data-v="${v}" aria-pressed="${ui[f] === v}">${l}</button>`).join("")}</div>`;
  const people2 = () => [...peopleNames().map(n => [n, n]), ["-", "Sem responsável"]];
  const payOpts = (cur, none = "Ninguém ainda") => [["", none], ...[...new Set(peopleNames().concat(cur || []))].map(n => [n, n])].map(([v, l]) => `<option value="${esc(v)}" ${v === (cur || "") ? "selected" : ""}>${esc(l)}</option>`).join("");
  const paidBy = entries => { const m = new Map(); entries.forEach(en => { const v = Number(en.r.paid) || 0; if (v) m.set(en.r.bought_by || "sem nome", (m.get(en.r.bought_by || "sem nome") || 0) + v); }); return [...m].map(([n, v]) => `${n} R$ ${money.format(v)}`).join("; "); };
  const paidSum = entries => entries.reduce((t, en) => t + (Number(en.r.paid) || 0), 0);
  const foodBlocks = () => FOOD.concat([...new Set(S.recipes.map(r => r.block))].filter(b => !BLOCKS.includes(b)));
  const short = n => String(n).replace(/\s*\(.*\)$/, "");
  function byCat(rs) {
    const m = new Map();
    [...rs].sort((a, b) => ((BLOCKS.indexOf(a.block) + 99) % 99) - ((BLOCKS.indexOf(b.block) + 99) % 99)).forEach(r => (m.get(r.block) || m.set(r.block, []).get(r.block)).push(r));
    return [...m];
  }
  function recipeOptions(sel) {
    return foodBlocks().map(b => {
      const rs = S.recipes.filter(r => r.block === b).sort(byPos);
      return rs.length ? `<optgroup label="${esc(b)}">${rs.map(r => `<option value="${r.id}" ${r.id === sel ? "selected" : ""}>${esc(r.name)}</option>`).join("")}</optgroup>` : "";
    }).join("");
  }

  function daySheet(d) {
    if (!d) return "";
    const L = dayLabel(d, true), entries = S.menu.filter(m => m.day_id === d.id).sort(byPos);
    return `<div class="sheet-bg" data-act="sheet-close"></div>
    <section class="sheet" role="dialog" aria-modal="true" aria-label="Cardápio de ${L.wk} ${L.dd}">
      <header><h2><b>${L.dd}</b> ${L.wk}, ${L.mon}</h2><button class="btn" id="sheet-x" data-act="sheet-close">Fechar</button></header>
<div class="day-body">
          ${entries.map(m => `<small class="cat">${esc((get("recipes", m.recipe_id) || {}).block || "")}</small><div class="entry">
            <select data-act="set" data-t="menu" data-id="${m.id}" data-f="recipe_id" aria-label="Prato do dia">${recipeOptions(m.recipe_id)}</select>
            <button class="ghost" data-act="open-recipe" data-id="${m.recipe_id}">Ver receita</button>
            ${(v => v.length ? `<p class="vegline">${LEAF}<span>${esc(v.join(", "))}</span></p>` : "")(vegItems(get("recipes", m.recipe_id) || {}))}
            <button class="x" data-act="del" data-t="menu" data-id="${m.id}" aria-label="Tirar do dia"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6"/></svg></button>
          </div>`).join("") || `<p class="empty">Nenhum prato neste dia.</p>`}
          <select class="adder" data-act="menu-add" data-day="${d.id}" aria-label="Adicionar prato ao dia"><option value="">Adicionar prato ou sobremesa…</option>${recipeOptions()}</select>
          <div class="meta">
            <label class="num">Pessoas ${inp("days", d.id, "people", d.people, 'type="number" min="0" inputmode="numeric"')}</label>
            ${chk("days", d.id, "veg_guest", d.veg_guest, "Precisa de opção vegetariana")}
          </div>
          ${d.veg_guest ? `<label class="fld vegopt">Notas da opção vegetariana${area("days", d.id, "veg_option", d.veg_option, "O que muda no prato deste dia")}<span class="note">O dia fica coberto com uma receita do tipo Opção vegetariana, ou com ingredientes do prato marcados com a folha.</span></label>` : ""}
          <label class="fld">Observações${area("days", d.id, "notes", d.notes, "Lembretes do dia")}</label>
        </div>
    </section>`;
  }

  function vMenu() {
    const days = [...S.days].sort((a, b) => a.date.localeCompare(b.date));
    const dinnerIdeas = S.recipes.filter(r => (r.block === "Jantar" || r.block === SIDE || r.block === VEG) && recipeCount(r) === 0).sort(byPos);
    const names = d => S.menu.filter(m => m.day_id === d.id).sort(byPos).map(m => get("recipes", m.recipe_id)).filter(Boolean);
    const cal = () => `<div class="hbox"><div class="calwrap"><div class="cal" style="--n:${days.length}">
      ${days.map(d => {
        const [y, m, dd] = d.date.split("-").map(Number), L = dayLabel(d, true), ds = names(d);
        return `<button class="calday ${d.veg_guest ? "veg" : ""}" data-act="goto-day" data-id="${d.id}" aria-label="Abrir ${L.wk} ${L.dd}: ${esc(byCat(ds).map(([b, l]) => (b === "Jantar" ? "" : b + ": ") + l.map(r => r.name).join(", ")).join("; ") || "sem prato")}${d.veg_guest ? ". " + ({ ok: "Opção vegetariana conferida", pend: "Opção vegetariana a conferir", miss: "Falta opção vegetariana" })[dayVegState(d)] : ""}">
          <span class="calnum"><b>${L.dd}</b> ${L.wk}, ${L.mon}</span>
          ${byCat(ds).map(([b, l]) => b === "Jantar" ? l.map(r => `<span class="dish main">${esc(short(r.name))}</span>`).join("")
            : `<span class="dgrp"><small class="cat">${esc(b === VEG ? "Vegetariana" : b)}</small>${l.map(r => `<span>${esc(short(r.name))}</span>`).join("")}</span>`).join("") || `<span class="dish none">sem prato</span>`}
          <span class="calfoot">${d.people} pessoas${d.veg_guest ? (st => `<span class="vflag ${st}">${LEAF_H}${st === "ok" ? "vegetariana ok" : st === "pend" ? "vegetariana a conferir" : "falta vegetariana"}</span>`)(dayVegState(d)) : ""}</span>
        </button>`;
      }).join("")}</div></div>${MORE}</div>
      <p class="hint">Toque num dia para abrir e editar. A faixa verde no topo marca os dias que precisam de opção vegetariana.</p>`;
    return `    <div class="seg" role="group" aria-label="Visualização">
      <button data-act="ui-set" data-f="menuView" data-v="list" aria-pressed="${ui.menuView !== "cal"}">Lista</button>
      <button data-act="ui-set" data-f="menuView" data-v="cal" aria-pressed="${ui.menuView === "cal"}">Calendário</button>
    </div>
    ${ui.menuView === "cal" ? cal() : `<section class="days">${days.map(d => {
      const L = dayLabel(d, true), ds = names(d);
      return `<article class="day ${d.veg_guest ? "veg" : ""}" id="d-${d.id}">
        <button class="day-h" data-act="sheet-day" data-id="${d.id}" aria-haspopup="dialog">
          <span class="date"><b>${L.dd}</b><span>${L.wk}</span></span>
          <span class="day-sum">${ds.length ? byCat(ds).map(([b, l]) => b === "Jantar" ? `<strong>${l.map(r => esc(r.name)).join(", ")}</strong>` : `<span class="extra"><small class="cat">${esc(b)}</small>${l.map(r => esc(r.name)).join(", ")}</span>`).join("") : `<strong class="none">Sem prato definido</strong>`}
            <small class="ppl">${d.people} pessoas${d.breakfast ? "" : ", sem café da manhã"}</small>${d.veg_guest ? vegTag(d) : ""}</span>
        </button>
      </article>`;
    }).join("")}</section>`}
    <h2>Café da manhã <small>${days.filter(d => d.breakfast).length} de ${days.length} dias</small></h2>
    <p class="hint">Marque os dias que vão ter café. Os itens do café contam uma vez, para a semana inteira.</p>
    <div class="daypick">${days.map(d => { const L = dayLabel(d, true); return `<button type="button" class="dchip" data-act="toggle-bf" data-d="${d.id}" aria-pressed="${!!d.breakfast}" aria-label="Café em ${L.wk} ${L.dd} de ${L.mon}"><b>${L.dd}</b><small>${L.wk}</small></button>`; }).join("")}</div>
    ${S.recipes.filter(r => r.block === CAFE).sort(byPos).map(r => `<button class="ghost" data-act="open-recipe" data-id="${r.id}">Ver itens do café da manhã</button>`).join("")}
    ${foodBlocks().filter(b => b !== "Jantar" && b !== SIDE && b !== CAFE && b !== VEG).map((b, k) => {
      const rs = S.recipes.filter(r => r.block === b).sort(byPos); if (!rs.length) return "";
      return `<h2>${esc(b)} <small>${rs.filter(r => recipeCount(r)).length} de ${rs.length} no cardápio</small></h2>
      ${k ? "" : `<p class="hint">Ligue o que vai ter durante a semana. O que fica desligado continua guardado como ideia e não entra nas compras.</p>`}
      <ul class="plain">${rs.map(r => { const ds = S.menu.filter(m => m.recipe_id === r.id).map(m => get("days", m.day_id)).filter(Boolean).sort((x, y) => x.date.localeCompare(y.date)).map(d => dayLabel(d));
        const st = r.weekly ? (ds.length ? "semana toda e " + ds.join(", ") : "semana toda") : ds.length ? "só em " + ds.join(", ") : "não vai";
        return `<li class="${recipeCount(r) ? "" : "off"}"><button class="rowlink" data-act="open-recipe" data-id="${r.id}">${esc(r.name)}<small>${esc(st)}</small></button>${isRev(r) ? `<span class="tag ok">conferida</span>` : ""}
          <label class="sw"><input type="checkbox" data-act="weekly-sw" data-id="${r.id}" ${recipeCount(r) ? "checked" : ""} aria-label="${esc(r.name)}: está no cardápio"><span></span></label></li>`; }).join("")}</ul>`;
    }).join("")}
    ${dinnerIdeas.length ? `<h2>Sugestões</h2>
    <p class="hint">Jantares, acompanhamentos e opções vegetarianas sem dia marcado. Ficam fora das compras; para usar, abra a receita e marque um dia.</p>
    <ul class="plain">${dinnerIdeas.map(r => `<li><button class="rowlink" data-act="open-recipe" data-id="${r.id}">${esc(r.name)}</button></li>`).join("")}</ul>` : ""}
    ${ui.sheet ? daySheet(get("days", ui.sheet)) : ""}`;
  }

  function vRecipes() {
    const cur = ui.rec && get("recipes", ui.rec);
    if (cur && cur.block !== "Casa") return `<button class="backlink" data-act="${ui.back ? "back" : "rec-close"}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>${ui.back ? "Cardápio" : "Receitas"}</button>${vRecipe(cur, "page")}`;
    ui.rec = null;
    const pass = r => (!ui.rBlock || r.block === ui.rBlock) && (!ui.rIn || (ui.rIn === "in") === !!recipeCount(r)) && (!ui.rRev || (ui.rRev === "ok") === isRev(r));
    const add = ui.open.has("newrec");
    return `<div class="srow rtop">
      <input type="search" id="rec-q" placeholder="Buscar receita" value="${esc(ui.rq || "")}" aria-label="Buscar receita">
      <button class="btn sm ${add ? "" : "primary"}" data-act="open" data-key="newrec" aria-expanded="${add}">${add ? "Fechar" : "+ Receita"}</button>
    </div>
    <div class="fchips" role="group" aria-label="Filtros">
      ${pill("rBlock", "Tipo", foodBlocks().map(b => [b, b]))}
      ${pill("rIn", "Cardápio", [["in", "No cardápio"], ["out", "Fora do cardápio"]])}
      ${pill("rRev", "Situação", [["ok", "Conferidas"], ["todo", "A conferir"]])}
      ${ui.rBlock || ui.rIn || ui.rRev ? `<button class="ghost" data-act="clear-rec">Limpar</button>` : ""}
    </div>
    ${add ? `<div class="paste">
      <form class="newrow" data-form="new-recipe">
        <input name="name" placeholder="Nome da receita nova" required>
        <select name="block" aria-label="Tipo">${FOOD.map(b => `<option>${b}</option>`).join("")}</select>
        <button class="btn primary">Criar vazia</button></form>
      <p class="hint">Ou cole a lista de ingredientes, uma linha para cada:</p>
      <form class="paste-in" data-form="paste-recipe">
        <input name="name" placeholder="Nome da receita" required>
        <select name="block" aria-label="Tipo">${FOOD.map(b => `<option>${b}</option>`).join("")}</select>
        <textarea name="text" rows="6" required placeholder="500 g carne moída&#10;2 latas de milho&#10;1 cebola"></textarea>
        <button class="btn primary">Criar com estes ingredientes</button></form></div>` : ""}
    ${foodBlocks().map(b => {
      const rs = S.recipes.filter(r => r.block === b && pass(r)).sort(byPos);
      return rs.length ? `<section class="rblock"><h2>${esc(b)} <small>${rs.length}</small></h2>${rs.map(r => vRecipe(r)).join("")}</section>` : "";
    }).join("") || `<p class="empty">Nenhuma receita com esses filtros.</p>`}`;
  }
  function filterRecipes() {
    const k = norm(ui.rq);
    view.querySelectorAll("section.rblock").forEach(sec => {
      let hit = 0;
      sec.querySelectorAll(":scope > .recipe").forEach(a => { a.hidden = !!k && !a.dataset.name.includes(k); if (!a.hidden) hit++; });
      sec.hidden = !hit;
    });
  }
  // tipo do ingrediente dentro da receita, só para ordenar e separar a lista na conferência
  const KIND_LABEL = ["Principais", "Acompanhamentos", "Extras", "Temperos", "Molhos e condimentos", "Outros"];
  const KIND_RE = [
    [5, /carvao|acendedor|copinho|filtro de papel|papel |guardanapo|detergente|saco de lixo|^gelo$/],
    [4, /ketchup|mostarda|maionese|shoyu|molho|tare$|azeite|^oleo|vinagre|extrato/],
    [3, /^sal$|sal grosso|flor de sal|pimenta|paprica|cominho|chilli|oregano|^alho$|coentro|cebolinha|^salsa|louro|canela|baunilha|fermento|bicarbonato|^gergelim|furikake|wasabi|gengibre|tempero/],
    [2, /batata palha|milho \(lata\)|crispy|granulado|avela|gotas de chocolate|^bacon/]];
  function ingKind(name, recipeName) {
    const k = norm(name), first = k.split(/[\s(]/)[0];
    if (first.length >= 4 && norm(recipeName).includes(first)) return 0;   // maionese na "Maionese de batata" é o principal
    return (KIND_RE.find(([, re]) => re.test(k)) || [0])[0];
  }
  function doubtsBlock(r, tag) {
    if (!hasCol("pendencias", "recipe_id")) return "";
    const qs = S.pendencias.filter(p => p.recipe_id === r.id).sort((a, b) => (a.done - b.done) || byPos(a, b));
    return `<${tag}>Dúvidas ${qs.length ? `<small>${qs.filter(p => p.done).length} de ${qs.length} resolvidas</small>` : ""}</${tag}>
      ${qs.length ? `<ul class="pend">${qs.map(p => pendRow(p, true)).join("")}</ul>` : ""}
      <form class="newrow one" data-form="add-pend" data-recipe="${r.id}"><input name="subject" placeholder="Escrever uma dúvida (use @ para marcar alguém)" data-sug="mention" autocomplete="off" required aria-label="Nova dúvida"><button class="btn">Adicionar</button></form>`;
  }
  function vRecipe(r, flat) {
    const detBlock = `<div class="rdetbox"><div class="grid2">
        <label class="fld">Nome${inp("recipes", r.id, "name", r.name)}</label>
        <label class="fld">Tipo<select data-act="set" data-t="recipes" data-id="${r.id}" data-f="block">${[...new Set(BLOCKS.concat(r.block))].map(b => `<option ${b === r.block ? "selected" : ""}>${esc(b)}</option>`).join("")}</select></label>
        <label class="fld">Para quantas pessoas${inp("recipes", r.id, "serves", r.serves)}</label>
      </div>
      <button class="btn danger" data-act="del" data-t="recipes" data-id="${r.id}">Excluir receita</button></div>`;
    const open = !!flat, page = flat === "page", st = recipeStatus(r);
    const autoK = i => ingKind((get("ingredients", i.ingredient_id) || {}).name, r.name);
    // o grupo escolhido à mão vale; sem escolha, o site decide pelo nome
    const kOf = i => flat === true ? 0 : KIND_LABEL.includes(i.kind) ? KIND_LABEL.indexOf(i.kind) : autoK(i);
    const items = S.recipe_items.filter(i => i.recipe_id === r.id).sort((a, b) => kOf(a) - kOf(b) || byPos(a, b));
    const kinds = new Set(items.map(kOf));
    const qs = S.pendencias.filter(p => p.recipe_id === r.id).sort((a, b) => (a.done - b.done) || byPos(a, b)), qOpen = qs.filter(p => !p.done).length;
    let body = "";
    if (open) bulk.set("r-" + r.id, { name: r.name, list: items.map(i => get("ingredients", i.ingredient_id)).filter(Boolean).map(x => ({ k: "i", r: x })) });
    if (open) body = `<div class="rbody">
      ${flat === true ? "" : `<section class="rsec">
${r.block === CAFE ? `<p class="note">Entra nas compras enquanto houver algum dia com café marcado no Cardápio.</p>` : `      <div class="fld">Quando entra no cardápio
        <div class="daypick">${[...S.days].sort((a, b) => a.date.localeCompare(b.date)).map(d => { const L = dayLabel(d, true), on = S.menu.some(m => m.day_id === d.id && m.recipe_id === r.id);
          return `<button type="button" class="dchip" data-act="toggle-day" data-r="${r.id}" data-d="${d.id}" aria-pressed="${on}" aria-label="${L.wk} ${L.dd} de ${L.mon}"><b>${L.dd}</b><small>${L.wk}</small></button>`; }).join("")}
          <button type="button" class="dchip wide" data-act="weekly" data-id="${r.id}" data-v="${r.weekly ? 0 : 1}" aria-pressed="${!!r.weekly}">Semana toda</button></div>
        ${r.weekly || S.menu.some(m => m.recipe_id === r.id) ? `<button type="button" class="ghost seecal" data-act="back">Ver no cardápio</button>` : `<span class="note">Sem nenhum dia marcado, a receita fica como ideia e não entra nas compras.</span>`}</div>`}
      ${hasCol("recipes", "brought") ? `<div class="fld">${chk("recipes", r.id, "brought", r.brought, "Alguém leva pronto (os ingredientes saem das compras)")}
        ${r.brought ? `<div class="pickwrap">${pickBtn(r.id, r.owner)}</div>${pickPanel("recipes", r.id, r.owner)}` : ""}</div>` : ""}
      </section>`}
      <section class="rsec">${flat === true ? "" : `<h3>Ingredientes <small>${CK() && flat !== true && items.length ? `${items.filter(isChk).length} de ${items.length} conferidos` : items.length}</small></h3>`}
      ${flat === true || !items.length ? "" : `<p class="hint">${CK() ? "Marque o que você conferiu (ingrediente e quantidade). Toque no nome para editar." : "Toque num ingrediente para editar."}</p>`}
      ${flat !== true && vegItems(r).length ? `<p class="vegline">${LEAF}<span>${esc(vegItems(r).join(", "))}</span></p>` : ""}
      <ul class="items">${items.map((it, idx) => {
        const g = get("ingredients", it.ingredient_id) || { name: "?", unit: "" };
        const sep = kinds.size > 1 && (idx === 0 || kOf(items[idx - 1]) !== kOf(it)) ? `<li class="ksep">${KIND_LABEL[kOf(it)]}</li>` : "";
        const more = ui.open.has(it.id), cp = cups(g, it.qty);
        const ck = CK() && flat !== true, by = checkers(it), mine = by.some(n => norm(n) === norm(who || "eu"));
        const tg = `${ck ? (by.length ? "" : it.suggested ? `<span class="tag sug">sugestão da IA</span>` : `<span class="tag new">novo</span>`) : it.suggested && !r.reviewed && flat !== true ? `<span class="tag sug">sugestão, confirmar</span>` : ""}${it.veg === "conferir" ? `<span class="tag sug">conferir rótulo (vegetariano)</span>` : ""}${isAtHouse(g) ? `<span class="tag new">tem na casa</span>` : isHome(g) ? (g.owner ? `<span class="tag new">${esc(g.owner)} leva</span>` : `<span class="tag nov">leva de casa, sem responsável</span>`) : ""}`;
        const ckBtn = ck ? `<button class="ckb" data-act="check" data-id="${it.id}" aria-pressed="${by.length > 0}" aria-label="${mine || (by.length && by.every(n => norm(n) === "caderno")) ? "Tirar a conferência de" : by.length ? "Já conferido por outra pessoa. Conferir também" : "Conferi"} ${esc(g.name)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></button>` : "";
        if (!more) return `${sep}<li class="ro">${ckBtn}<button class="itro" data-act="open" data-key="${it.id}" aria-expanded="false" aria-label="Editar ${esc(g.name)}">
          <span class="itn">${esc(g.name)}${it.veg === "sim" ? LEAF : ""}</span><b>${esc(fmtQty(it.qty, g.unit))}</b>
          ${cp || it.note || tg ? `<span class="itx">${cp ? `<small>${cp}</small>` : ""}${it.note ? `<small>${esc(it.note)}</small>` : ""}${tg}</span>` : ""}</button></li>`;
        return `${sep}<li class="it">
          <div class="ithead">${ckBtn}<button class="itro on" data-act="open" data-key="${it.id}" aria-expanded="true" aria-label="Fechar ${esc(g.name)}"><span class="itn">${esc(g.name)}${it.veg === "sim" ? LEAF : ""}</span><b>${esc(fmtQty(it.qty, g.unit))}</b></button></div>
          <div class="itedit">
            <input class="iname" data-act="repoint" data-id="${it.id}" value="${esc(g.name)}" data-sug="ings" autocomplete="off" aria-label="Ingrediente">
            <input class="iqty" data-act="set" data-t="recipe_items" data-id="${it.id}" data-f="qty" data-num="1" value="${esc(nf.format(it.qty || 0).replace(/\./g, ""))}" inputmode="decimal" aria-label="Quantidade">
            ${g.id ? `<input class="iunit" data-act="set" data-t="ingredients" data-id="${g.id}" data-f="unit" value="${esc(g.unit)}" data-sug="units" autocomplete="off" autocapitalize="none" aria-label="Unidade de ${esc(g.name)}">` : `<span class="unit">${esc(g.unit)}</span>`}
            <button class="x" data-act="del" data-t="recipe_items" data-id="${it.id}" aria-label="Tirar ${esc(g.name)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6"/></svg></button>
          </div>
          ${ck ? `<p class="ckby">${(pp => !by.length ? (it.suggested ? "Sugestão da IA, ninguém conferiu ainda." : "Novo, ninguém conferiu ainda.") : pp.length ? `Conferido por ${esc(pp.join(", "))}.` : "Veio do caderno, conta como conferido.")(by.filter(n => norm(n) !== "caderno"))}
            ${hasCol("pendencias", "recipe_id") && !ui.open.has("q-" + it.id) ? `<button class="inl" data-act="open" data-key="q-${it.id}">Abrir dúvida</button>` : ""}</p>
          ${hasCol("pendencias", "recipe_id") && ui.open.has("q-" + it.id) ? `<form class="newrow qform" data-form="add-pend" data-recipe="${r.id}" data-about="${esc(g.name)}" data-item="${it.id}"><input name="subject" placeholder="Pergunte ou conteste (use @ para marcar alguém)" data-sug="mention" autocomplete="off" required aria-label="Dúvida sobre ${esc(g.name)}"><button class="btn">Enviar</button><button type="button" class="ghost" data-act="open" data-key="q-${it.id}">Cancelar</button></form>` : ""}` : tg ? `<div class="tags">${tg}</div>` : ""}
          ${more ? `<div class="more">
            ${dens(g) ? `<label class="fld">Em xícaras${cp ? ` (hoje: ${cp})` : ""}<input data-act="cups" data-id="${it.id}" inputmode="decimal" placeholder="ex.: 1,5"></label>` : ""}
            <label class="fld">Observação${inp("recipe_items", it.id, "note", it.note)}</label>
            ${g.id ? `<label class="fld">Seção do mercado${inp("ingredients", g.id, "sector", secOf(g), 'data-sug="sectors" autocomplete="off"')}</label>
            <label class="fld">Loja${inp("ingredients", g.id, "store", g.store, 'data-sug="stores" autocomplete="off" placeholder="Mercado, atacado, feira…"')}</label>
            ${planSel(g)}` : ""}
            ${g.id ? `<div class="fld">Responsável por este ingrediente<div class="pickwrap">${pickBtn(g.id, g.owner)}</div>${pickPanel("ingredients", g.id, g.owner)}</div>` : ""}
            ${hasCol("recipe_items", "kind") && flat !== true ? `<label class="fld">Grupo nesta receita<select data-act="set" data-t="recipe_items" data-id="${it.id}" data-f="kind"><option value="">Automático (${KIND_LABEL[autoK(it)]})</option>${KIND_LABEL.map(k => `<option ${it.kind === k ? "selected" : ""}>${k}</option>`).join("")}</select></label>` : ""}
            <label class="fld">Alternativa vegetariana?<select data-act="set" data-t="recipe_items" data-id="${it.id}" data-f="veg">
              <option value="" ${it.veg !== "sim" && it.veg !== "conferir" ? "selected" : ""}>Não marcado</option><option value="sim" ${it.veg === "sim" ? "selected" : ""}>Sim, é o que substitui a carne</option><option value="conferir" ${it.veg === "conferir" ? "selected" : ""}>Conferir rótulo</option></select></label>
            <button class="btn sm done" data-act="open" data-key="${it.id}" aria-expanded="true">Fechar</button>
          </div>` : ""}
        </li>`;
      }).join("") || `<li class="empty">Sem ingredientes ainda.</li>`}</ul>
      <div class="itools"><button class="btn sm" data-act="open" data-key="add-${r.id}" aria-expanded="${ui.open.has("add-" + r.id)}">${ui.open.has("add-" + r.id) ? "Fechar" : flat === true ? "+ Item" : "+ Ingrediente"}</button>
        ${flat === true ? "" : `<button class="ghost" data-act="copy-list" data-key="r-${r.id}">Copiar lista</button><button class="ghost" data-act="open" data-key="bulk-r-${r.id}">Responsável</button>`}</div>${flat === true ? "" : bulkPanel("r-" + r.id)}
      ${!ui.open.has("add-" + r.id) ? "" : `<form class="additem" data-form="add-item" data-id="${r.id}">
        <input name="name" placeholder="${flat === true ? "Item" : "Ingrediente"}" data-sug="ings" autocomplete="off" required data-act="ing-hint">
        <input name="qty" placeholder="Qtd" inputmode="decimal">
        <input name="unit" placeholder="${flat === true ? "un, g, lata…" : "g, xícara…"}" autocapitalize="none" data-sug="units" autocomplete="off">
        <button class="btn">Adicionar</button>
        ${hasCol("recipe_items", "kind") && flat !== true ? `<label class="kindpick">Grupo <select name="kind"><option value="">Automático</option>${KIND_LABEL.map(k => `<option>${k}</option>`).join("")}</select></label>` : ""}
        <label class="secpick" hidden>Ingrediente novo. Seção do mercado <select name="sector"><option value="">Escolher…</option>${SECTORS.map(x => `<option>${esc(x)}</option>`).join("")}</select></label>
        ${flat === true ? "" : `<p class="hint">Xícara e colher de sopa de farinha, açúcar, manteiga, leite e parecidos são convertidas para g ou ml.</p>`}
      </form>`}
      </section>
      ${flat === true ? "" : `<section class="rsec"><h3><label for="prep-${r.id}">Modo de preparo e notas</label></h3><textarea id="prep-${r.id}" data-act="set" data-t="recipes" data-id="${r.id}" data-f="prep" rows="${Math.min(12, Math.max(3, (r.prep || "").split("\n").length + 1))}" placeholder="Passos, dicas, quem faz">${esc(r.prep)}</textarea>${linkList(r.prep)}</section>`}
      ${flat === true ? "" : `<section class="rsec">${doubtsBlock(r, "h3")}</section>`}
      ${CK() ? "" : `<div class="review ${r.reviewed ? "ok" : ""}">${r.reviewed
        ? `<span>Revisada${r.reviewed_by ? " por " + esc(r.reviewed_by) : ""}. Ingredientes e quantidades confirmados.</span><button class="ghost" data-act="review" data-id="${r.id}" data-v="0">Desfazer</button>`
        : qOpen ? `<span>Resolva ${qOpen === 1 ? "a dúvida acima" : `as ${qOpen} dúvidas acima`} antes de marcar como revisada.</span>`
        : `<span>Leu a lista inteira?</span><button class="btn primary" data-act="review" data-id="${r.id}" data-v="1">Marcar como revisada</button>`}</div>`}
    </div>`;
    const badges = `${r.brought ? `<span class="tag">leva pronto</span>` : ""}${qOpen ? `<span class="tag nov">${qOpen} ${qOpen === 1 ? "dúvida" : "dúvidas"}</span>` : ""}${st.idea ? "" : isRev(r) ? `<span class="tag ok">conferida</span>` : `<span class="tag sug">a conferir</span>`}`;
    if (flat === true) return `<article class="recipe open flat" id="r-${r.id}">${body}</article>`;
    if (page) return `<article class="recipe page" id="r-${r.id}"><header class="rpage"><p class="rkind">${esc(r.block)}${r.serves ? `, para ${esc(r.serves)}` : ""}</p><div class="rtitle"><h2>${esc(r.name)}</h2><button class="icon" data-act="open" data-key="det-${r.id}" aria-expanded="${ui.open.has("det-" + r.id)}" aria-label="Editar nome, tipo e número de pessoas"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4"/></svg></button></div><p class="rmeta ${st.idea ? "idea" : ""}">${esc(st.text[0].toUpperCase() + st.text.slice(1))}</p><p class="rtags">${badges}</p>${ui.open.has("det-" + r.id) ? detBlock : ""}</header>${body}</article>`;
    return `<article class="recipe" id="r-${r.id}" data-name="${esc(norm(r.name))}">
      <button class="rhead chev" data-act="rec-open" data-id="${r.id}"><span>
        <span class="rname">${esc(r.name)}</span>
        <span class="rmeta ${st.idea ? "idea" : ""}">${esc(st.text)}</span></span>
        ${qOpen ? `<span class="tag nov">${qOpen} ${qOpen === 1 ? "dúvida" : "dúvidas"}</span>` : ""}
        ${r.brought ? `<span class="rprog ok" title="Levada pronta">pronta</span>` : CK() ? (n => items.length ? `<span class="rprog ${n === items.length ? "ok" : ""}" aria-label="${n} de ${items.length} ingredientes conferidos">${n}/${items.length}</span>` : `<span class="rprog none">sem itens</span>`)(items.filter(isChk).length) : (st.idea ? "" : isRev(r) ? `<span class="tag ok">conferida</span>` : `<span class="tag sug">a conferir</span>`)}
      </button></article>`;
  }

  function vShop() {
    const tot = shopping(), all = buyEntries(tot);
    const vals = g => [...new Set(all.map(en => keyOf(en, g)))].sort((x, y) => g === "when_buy" ? ((WHEN.indexOf(x) + 99) % 99) - ((WHEN.indexOf(y) + 99) % 99) : (x === NONE[g]) - (y === NONE[g]) || x.localeCompare(y, "pt"));
    const FK = { fSector: "sector", fStore: "store", fWhen: "when_buy", fType: "type" };
    for (const k in FK) if (ui[k] && !vals(FK[k]).includes(ui[k])) ui[k] = "";
    const noQty = en => en.k === "i" && !(tot.get(en.r.id) || {}).qty, nNoQty = all.filter(en => noQty(en) && !isDone(en)).length;
    if (!nNoQty) ui.fNoQty = "";
    const shown = all.filter(en => passF(en, { who: ui.fWho, status: ui.fStatus, rev: ui.fRev, sector: ui.fSector, store: ui.fStore, when: ui.fWhen, type: ui.fType }) && (!ui.fNoQty || noQty(en)));
    const active = ["fWho", "fRev", "fSector", "fStore", "fWhen", "fType", "fNoQty"].filter(k => ui[k]).length;
    const paid = paidSum(all);
    const FDEF = [["fWho", "Pessoa", people2()], ["fSector", "Seção", vals("sector").map(x => [x, x])], ["fWhen", "Momento", vals("when_buy").map(x => [x, x])], ["fStore", "Loja", vals("store").map(x => [x, x])],
      ...(vals("type").length > 1 ? [["fType", "Comida ou item", vals("type").map(x => [x, x])]] : []), ["fRev", "Conferência", [["ok", "Já conferido"], ["todo", "A conferir"]]]];
    return `<div class="shopbar">
      <div class="srow"><input type="search" id="shop-q" placeholder="Buscar item" value="${esc(ui.q)}" aria-label="Buscar item">
        <select class="grpsel" data-act="ui" data-f="group" aria-label="Agrupar por">${Object.entries(GROUPS).map(([v, l]) => `<option value="${esc(v)}" ${ui.group === v ? "selected" : ""}>Por ${esc(l.toLowerCase())}</option>`).join("")}</select></div>
      <div class="srow">${seg3("fStatus", ["Tudo", "Falta", "Comprado"])}
        <button class="btn sm fbtn ${active ? "on" : ""}" data-act="fsheet" data-v="1" aria-haspopup="dialog">Filtros${active ? ` (${active})` : ""}</button></div>
    </div>
    ${nNoQty && !ui.fNoQty ? `<button class="mebar" data-act="ui-set" data-f="fNoQty" data-v="1"><b>${nNoQty}</b> ${nNoQty === 1 ? "item sem quantidade definida" : "itens sem quantidade definida"}<span>Ver</span></button>` : ""}
    ${active ? `<div class="factive">${ui.fNoQty ? `<button class="tagbtn" data-act="ui-set" data-f="fNoQty" data-v="" aria-label="Tirar filtro sem quantidade">Sem quantidade <span aria-hidden="true">✕</span></button>` : ""}${FDEF.filter(([k]) => ui[k]).map(([k, label, opts]) => `<button class="tagbtn" data-act="ui-set" data-f="${k}" data-v="" aria-label="Tirar filtro ${esc(label)}">${esc(label)}: ${esc((opts.find(o => o[0] === ui[k]) || [0, ui[k]])[1])} <span aria-hidden="true">✕</span></button>`).join("")}</div>` : ""}
    ${ui.fsheet ? `<div class="sheet-bg" data-act="fsheet" data-v=""></div>
    <section class="sheet" role="dialog" aria-modal="true" aria-label="Filtros de compras">
      <header><h2>Filtros</h2><button class="btn" id="sheet-x" data-act="fsheet" data-v="">Ver ${shown.length} ${shown.length === 1 ? "item" : "itens"}</button></header>
      <div class="fsheet">${FDEF.map(([k, label, opts]) => `<label class="fld">${esc(label)}<select data-act="ui" data-f="${k}"><option value="">Todos</option>${opts.map(([v, l]) => `<option value="${esc(v)}" ${ui[k] === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>`).join("")}
        ${active ? `<button class="ghost" data-act="clear-filters">Limpar filtros</button>` : ""}</div>
    </section>` : ""}
    ${paid || active || ui.fStatus ? `<p class="hint">${paid ? `R$ ${money.format(paid)} pagos até agora (${esc(paidBy(all))}). ` : ""}${active || ui.fStatus ? `Mostrando ${shown.length} de ${all.length} itens.` : ""}</p>` : ""}
    ${shown.some(en => en.k === "i" && revMap.has(en.r.id)) ? `<p class="shoplegend" aria-hidden="true"><i class="qdot"></i>quantidade ainda a conferir</p>` : ""}
    ${groupList(shown, ui.group, tot, "h2", active || ui.fStatus ? "shopf" : "shop", !!(active || ui.fStatus)) || `<p class="empty">${all.length ? "Nenhum item com esses filtros." : "Nada para comprar: o cardápio está vazio."}</p>`}
    <button class="btn sm addx" data-act="open" data-key="newbuy" aria-expanded="${ui.open.has("newbuy")}">${ui.open.has("newbuy") ? "Fechar" : "+ Compra que não é comida"}</button>
    ${ui.open.has("newbuy") ? `<form class="newrow" data-form="add-extra" data-buy="1"><input name="item" placeholder="O que comprar" required><button class="btn">Adicionar</button></form>` : ""}
    <p class="hint">O que vem de casa fica na aba Levar. Itens de Levar e Entretenimento marcados com "Precisa comprar" aparecem aqui.</p>`;
  }
  function vItem(i, e, g) {
    const open = ui.open.has(i.id), done = i.bought, pend = revMap.get(i.id);
    const hintDup = (() => { const m = norm(i.buy_hint).replace(/^~\s*/, "").match(/^([\d.,]+)\s*([a-zç]*)$/); if (!m) return false; const f = norm(fmtQty(e.qty, i.unit)).match(/^([\d.,]+)\s*(.*)$/); return !!f && num(m[1]) === num(f[1]) && (!m[2] || m[2].slice(0, 3) === f[2].slice(0, 3)); })();
    const stale = !!i.buy_hint && i.hint_qty != null && Math.abs(Number(i.hint_qty) - e.qty) > 1e-6;
    return `<li class="item ${done ? "done" : ""}" data-name="${esc(norm(i.name))}">
      ${tick("ingredients", i.id, "bought", i.bought, (isHome(i) ? "Separado: " : "Comprado: ") + i.name)}
      <button class="imain" data-act="open" data-key="${i.id}" aria-expanded="${open}">
        <span class="iname2">${esc(i.name)}</span><span class="iqty2">${pend ? `<i class="qdot" title="Quantidade a conferir"></i><span class="sr">a conferir: </span>` : ""}${esc(fmtQty(e.qty, i.unit))}</span>
        <span class="isub">${stale || hintDup ? "" : esc(i.buy_hint)}</span>
        <span class="chips">${(() => { const t = [

          i.owner ? `<span class="tag who">${esc(i.owner)}</span>` : "",
          i.bought && i.bought_by ? `<span class="tag ok">pago por ${esc(i.bought_by)}</span>` : "",
          g !== "sector" && secOf(i) ? `<span class="tag ${SECTORS.includes(secOf(i)) ? "sec-" + SECTORS.indexOf(secOf(i)) : ""}">${esc(secOf(i))}</span>` : "",
          g !== "when_buy" && whenOf(i) && !isHome(i) ? `<span class="tag t-when">${esc(whenOf(i))}</span>` : "",
          bfCol() && isBF(i) && !isHome(i) && whenOf(i) !== BF ? `<span class="tag t-when">era Black Friday</span>` : "",
          isFreeze(i) && !isHome(i) ? `<span class="tag t-frz">congelar</span>` : "",
          g !== "store" && i.store ? `<span class="tag t-store">${esc(i.store)}</span>` : ""].filter(Boolean);
          return open || t.length <= 2 ? t.join("") : t.slice(0, 2).join("") + `<span class="tag">+${t.length - 2}</span>`; })()}</span>
      </button>
      ${open ? `<div class="ibody">
        <div class="grid2">
          <label class="fld">Nome (muda em todas as receitas)${inp("ingredients", i.id, "name", i.name)}</label>
          <label class="fld">Unidade${inp("ingredients", i.id, "unit", i.unit, 'data-sug="units" autocomplete="off"')}</label>
          <label class="fld">Como comprar (embalagem)${inp("ingredients", i.id, "buy_hint", i.buy_hint)}${stale ? `<span class="stale">Escrito quando o total era ${esc(fmtQty(Number(i.hint_qty), i.unit))}. Atualize ou apague.</span>` : ""}</label>
          <div class="fld">Responsável<div class="pickwrap">${pickBtn(i.id, i.owner)}</div>${pickPanel("ingredients", i.id, i.owner)}</div>
          ${planSel(i)}
          <label class="fld">Seção do mercado${inp("ingredients", i.id, "sector", secOf(i), 'data-sug="sectors" autocomplete="off"')}</label>
          <label class="fld">Valor pago (R$)<input data-act="set" data-t="ingredients" data-id="${i.id}" data-f="paid" data-num="1" value="${esc(numIn(i.paid))}" inputmode="decimal" placeholder="0,00"></label>
          ${isHome(i) || !hasCol("ingredients", "bought_by") ? "" : `<label class="fld">Quem pagou<select data-act="set" data-t="ingredients" data-id="${i.id}" data-f="bought_by">${payOpts(i.bought_by)}</select></label>`}
          <label class="fld">Loja${inp("ingredients", i.id, "store", i.store, 'data-sug="stores" autocomplete="off" placeholder="Mercado, atacado, feira…"')}</label>
        </div>
        ${isHome(i) || !hasCol("ingredients", "can_freeze") ? "" : chk("ingredients", i.id, "can_freeze", isFreeze(i), "Dá para comprar antes e congelar")}

        <label class="fld">Observação${area("ingredients", i.id, "note", i.note, "Marca, tipo, onde achar")}</label>
        ${pend ? `<p class="uses warnline">Quantidade a conferir em: ${pend.map(esc).join(", ")}.</p>` : ""}
        <p class="uses">Usado em:</p>
        <ul class="useslist">${e.uses.map(u => `<li><button class="ghost" data-act="open-recipe" data-id="${u.id}">${esc(u.name)}</button><span>${esc(fmtQty(u.qty, i.unit))}${u.times > 1 ? " × " + u.times : ""}</span></li>`).join("")}</ul>
      </div>` : (i.note ? `<p class="inote">${esc(i.note)}</p>` : "")}
    </li>`;
  }

  const fmtWhen = v => { const d = new Date(v); return isNaN(d) ? "" : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); };
  // @Nome: destaca e avisa a pessoa marcada
  const mentionRe = () => { const n = peopleNames().sort((a, b) => b.length - a.length).map(x => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")); return n.length ? new RegExp("@(" + n.join("|") + ")(?![\\p{L}\\d])", "giu") : null; };
  // endereço vira link com nome curto ("vídeo no Instagram") em vez do endereço inteiro
  const URL_RE = /https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)]/g;
  const SITES = [[/tiktok\.com/, "vídeo no TikTok"], [/youtube\.com|youtu\.be/, "vídeo no YouTube"], [/instagram\.com/, "vídeo no Instagram"]].map(([re, n]) => [new RegExp("^https?://([\\w-]+\\.)*(" + re.source + ")(/|$)"), n]);
  // endereços do texto; inclui o ")" final quando ele fecha um "(" do próprio endereço (Wikipedia)
  const urlsIn = str => [...String(str || "").matchAll(URL_RE)].map(m => { let u = m[0]; const nx = str[m.index + u.length]; if (nx === ")" && (u.match(/\(/g) || []).length > (u.match(/\)/g) || []).length) u += ")"; return { u, i: m.index }; });
  const linkName = u => { const k = SITES.find(([re]) => re.test(u)); if (k) return k[1]; try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return "link"; } };
  const anchor = u => `<a class="xlink" href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(linkName(u))}</a>`;
  const rich = t => {
    const re = mentionRe(), part = x => { const e = esc(x); return re ? e.replace(re, m => `<b class="mention">${m}</b>`) : e; };
    let out = "", last = 0; const str = String(t || "");
    for (const { u, i } of urlsIn(str)) { out += part(str.slice(last, i)) + anchor(u); last = i + u.length; }
    return out + part(str.slice(last));
  };
  const LINK_ICO = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7.5v9l7-4.5z"/></svg>`;
  // links do texto como etiquetas: nome do site em destaque e, se houver, a descrição escrita antes do endereço
  const linkList = t => { const str = String(t || ""), l = [...new Set(urlsIn(str).map(x => x.u))]; if (!l.length) return "";
    return `<div class="links">${l.map(u => { const before = str.slice(0, str.indexOf(u)).split("\n").pop().replace(/^[\d.\-\s]+/, "").replace(/[:\s]+$/, "");
      const k = SITES.find(([re]) => re.test(u)), site = k ? k[1].replace("vídeo no ", "") : linkName(u);
      const desc = before && before.length < 90 ? (norm(before).startsWith(norm(site)) ? before.slice(site.length).replace(/^[,:\s]+/, "") : before) : "";
      return `<a class="lchip" href="${esc(u)}" target="_blank" rel="noopener noreferrer">${LINK_ICO}<span><b>${esc(site)}</b>${desc ? `<small>${esc(desc)}</small>` : ""}</span></a>`; }).join("")}</div>`; };
  const pendText = p => [p.subject, p.detail, ...S.comments.filter(c => c.pend_id === p.id).map(c => c.body)].join(" ");
  const myName = () => client ? (peopleNames().find(n => norm(n) === norm(who)) || who || "") : meName();
  const tagsMe = p => { const me = norm(myName()), re = mentionRe(); return !!me && !!re && !p.done && [...pendText(p).matchAll(re)].some(m => norm(m[1]) === me); };
  function thread(p) {
    const cs = S.comments.filter(c => c.pend_id === p.id).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    return `<div class="thread">
      ${p.answer ? `<div class="msg"><p><b>Resposta anterior</b>${esc(p.answer)}</p></div>` : ""}
      ${cs.map(c => { const own = !client || norm(c.author) === norm(who);
        if (ui.open.has("ec-" + c.id)) return `<form class="newrow" data-form="edit-comment" data-id="${c.id}"><input name="body" value="${esc(c.body)}" required aria-label="Editar comentário"><button class="btn">Salvar</button><button type="button" class="ghost" data-act="open" data-key="ec-${c.id}">Cancelar</button></form>`;
        return `<div class="msg"><p><b>${esc(c.author || "Sem nome")} <small>${fmtWhen(c.created_at)}</small></b>${rich(c.body)}</p>${own ? `<span class="acts">
          <button class="icon" data-act="open" data-key="ec-${c.id}" aria-label="Editar comentário"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4"/></svg></button>
          <button class="icon" data-act="del" data-t="comments" data-id="${c.id}" aria-label="Apagar comentário"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6"/></svg></button></span>` : ""}</div>`; }).join("")}
      ${ui.open.has("cm-" + p.id) ? `<form class="newrow cform" data-form="add-comment" data-pend="${p.id}"><input name="body" placeholder="Escreva (use @ para marcar alguém)" data-sug="mention" autocomplete="off" required aria-label="Comentar em ${esc(p.subject)}"><button class="btn">Enviar</button></form>` : ""}</div>`;
  }
  function pendRow(p, inRecipe) {
    const key = norm(String(p.subject).split(":")[0]);
    const sug = S.recipes.filter(r => key && (norm(r.name).includes(key) || key.includes(norm(r.name))));
    const others = S.recipes.filter(r => !sug.includes(r)).sort((a, b) => a.name.localeCompare(b.name, "pt"));
    const o = r => `<option value="${r.id}">${esc(r.name)}</option>`;
    return `<li class="${p.done ? "done" : ""}" data-txt="${esc(norm(p.subject + " " + (p.detail || "")))}">
      ${tick("pendencias", p.id, "done", p.done, "Resolvido: " + p.subject)}
      <div>${ui.open.has("ep-" + p.id) ? `<form class="pedit" data-form="edit-pend" data-id="${p.id}"><input name="subject" value="${esc(p.subject)}" required aria-label="Texto da pendência"><textarea name="detail" rows="${Math.min(8, Math.max(2, Math.ceil(String(p.detail || "").length / 34)))}" placeholder="Detalhe (opcional)" aria-label="Detalhe">${esc(p.detail)}</textarea><div><button class="btn">Salvar</button><button type="button" class="ghost" data-act="open" data-key="ep-${p.id}">Cancelar</button></div></form>`
        : `<strong>${rich(p.subject)}</strong>${p.detail ? `<p>${rich(p.detail)}</p>` : ""}`}
        ${noComments ? area("pendencias", p.id, "answer", p.answer, p.kind === "Dúvida" ? "Resposta" : "Comentário") : thread(p)}
        <div class="pacts">${noComments ? "" : `<button class="ghost" data-act="open" data-key="cm-${p.id}" aria-expanded="${ui.open.has("cm-" + p.id)}">${ui.open.has("cm-" + p.id) ? "Fechar" : "Comentar"}</button>`}${!hasCol("pendencias", "recipe_id") ? "" : inRecipe ? `<button class="ghost" data-act="pend-out" data-id="${p.id}" aria-label="Tirar da receita">Desvincular</button>`
          : `<button class="ghost" data-act="open" data-key="lk-${p.id}" aria-expanded="${ui.open.has("lk-" + p.id)}" aria-label="Vincular a uma receita">Vincular</button>`}
        <span class="acts">${ui.open.has("ep-" + p.id) ? "" : `<button class="icon" data-act="open" data-key="ep-${p.id}" aria-label="Editar pendência"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4"/></svg></button>`}
        <button class="icon" data-act="del" data-t="pendencias" data-id="${p.id}" aria-label="Excluir pendência"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6"/></svg></button></span></div>
        ${!inRecipe && ui.open.has("lk-" + p.id) ? `<div class="linker"><input type="search" class="lk-q" placeholder="Buscar receita" aria-label="Buscar receita">
          <div class="lk-list">${[...sug, ...others].map(r => `<button class="tagbtn" data-act="pend-link" data-id="${p.id}" data-r="${r.id}" data-name="${esc(norm(r.name))}">${esc(r.name)}</button>`).join("")}</div></div>` : ""}</div></li>`;
  }
  function vPend() {
    // as dúvidas de receita aparecem aqui também, agrupadas pela receita, para a conversa ficar num lugar só
    const recOf = p => (p.recipe_id && get("recipes", p.recipe_id)) || null;
    const withRec = [...new Set(S.pendencias.map(recOf).filter(Boolean))].sort((a, b) => a.name.localeCompare(b.name, "pt"));
    if (ui.pRec && ui.pRec !== "none" && !withRec.some(r => r.id === ui.pRec)) ui.pRec = "";
    const mine = S.pendencias.filter(tagsMe);
    if (!mine.length) ui.pMe = false;
    const list = (ui.pMe ? mine : S.pendencias).filter(p => ui.pMe || ((!ui.pStatus || (ui.pStatus === "done") === !!p.done) && (!ui.pRec || (ui.pRec === "none" ? !recOf(p) : p.recipe_id === ui.pRec))));
    const free = list.filter(p => !recOf(p)), kinds = [...new Set(free.map(p => p.kind))];
    const recs = withRec.filter(r => list.some(p => p.recipe_id === r.id));
    const row = p => pendRow(p, !!recOf(p));
    return `<button class="btn sm" data-act="open" data-key="newpend" aria-expanded="${ui.open.has("newpend")}">${ui.open.has("newpend") ? "Fechar" : "+ Pendência"}</button>
    ${ui.open.has("newpend") ? `<form class="newrow" data-form="add-pend">
      <input name="subject" placeholder="Assunto" required><input name="detail" placeholder="Qual é a dúvida? Use @ para marcar alguém" data-sug="mention" autocomplete="off">
      <button class="btn primary">Adicionar pendência</button></form>` : ""}
    ${mine.length ? `<button class="mebar" data-act="ui-set" data-f="pMe" data-v="${ui.pMe ? "" : "1"}" aria-pressed="${!!ui.pMe}"><b>${mine.length}</b> ${mine.length === 1 ? "pendência marca você" : "pendências marcam você"}<span>${ui.pMe ? "Ver todas" : "Ver"}</span></button>` : ""}
    <div class="pfilter">${seg3("pStatus", ["Todas", "Abertas", "Resolvidas"])}
      ${pill("pRec", "Receita", [["none", "Sem receita"], ...withRec.map(r => [r.id, r.name])])}</div>
    ${S.pendencias.length > 5 ? `<input type="search" id="pend-q" placeholder="Buscar nas pendências" aria-label="Buscar nas pendências">` : ""}
    ${kinds.map(k => {
      const l = free.filter(p => p.kind === k).sort(byPos);
      return `<section class="pgrp"><h2>${esc(kinds.length > 1 ? k : "Gerais")} <small>${l.length}</small></h2><ul class="pend">${l.map(row).join("")}</ul></section>`;
    }).join("")}
    ${recs.map(r => { const l = list.filter(p => p.recipe_id === r.id).sort(byPos);
      return `<section class="pgrp"><h2><button class="h2link" data-act="open-recipe" data-id="${r.id}">${esc(r.name)}</button> <small>${l.length}</small></h2><ul class="pend">${l.map(row).join("")}</ul></section>`; }).join("")}
    ${list.length ? "" : `<p class="empty">${S.pendencias.length ? "Nenhuma pendência com esses filtros." : "Nenhuma pendência ainda."}</p>`}`;
  }

  function vTake() {
    const tot = shopping(), all = takeEntries(tot);
    const shown = all.filter(en => passF(en, { who: ui.tWho, status: ui.tStatus }));
    const orphans = all.filter(en => !en.r.owner && !isDone(en)), orphan = orphans.map(nameOf);
    bulk.set("orphans", { name: "Sem responsável", list: orphans });
    return `${orphan.length ? `<div class="warnbar"><span><b>${orphan.length}</b> ${orphan.length === 1 ? "item sem responsável" : "itens sem responsável"}</span>
      <span class="warn-acts"><button class="ghost" data-act="open" data-key="bulk-orphans">Atribuir</button>${ui.tWho === "-" ? `<button class="ghost" data-act="ui-set" data-f="tWho" data-v="">Ver todos</button>` : `<button class="ghost" data-act="ui-set" data-f="tWho" data-v="-">Ver</button>`}</span>
      ${bulkPanel("orphans")}</div>` : ""}
    <div class="frow">${seg3("tStatus", ["Tudo", "Falta", "Separado"])}${pill("tWho", "Pessoa", people2())}</div>
    ${ui.tWho || ui.tStatus ? `<button class="ghost clearf" data-act="clear-take">Limpar filtros</button>` : ""}
    ${groupList(shown, "origin", tot, "h2", "take") || `<p class="empty">${all.length ? "Nenhum item com esses filtros." : "Nada na lista ainda."}</p>`}
    <form class="newrow" data-form="add-extra"><input name="item" placeholder="Adicionar item de uso geral" required><button class="btn">Adicionar</button></form>
    ${(h => h.length ? `<details class="unused"><summary>Já tem na casa (${h.length})</summary><p class="hint">Não entram em Compras nem em Levar. Vale confirmar com o dono da casa.</p>
      <ul class="plain">${h.map(i => `<li><span>${esc(i.name)}</span><button class="ghost" data-act="unhouse" data-id="${i.id}">Voltar para as compras</button></li>`).join("")}</ul></details>` : "")(S.ingredients.filter(i => tot.has(i.id) && isAtHouse(i)).sort((a, b) => a.name.localeCompare(b.name, "pt")))}
    <p class="hint">Marcar "Precisa comprar" manda o item para a aba Compras. Os itens de cada atividade são criados na aba Entretenimento, e os suprimentos da casa, na aba Casa.</p>`;
  }

  function vHome() {
    const lists = S.recipes.filter(r => r.block === "Casa").sort(byPos);
    const plain = S.extras.filter(e => !e.activity_id).sort((a, b) => (a.done - b.done) || (!a.owner - !b.owner) || String(a.owner || "").localeCompare(String(b.owner || ""), "pt") || a.item.localeCompare(b.item, "pt"));
    const nSup = S.recipe_items.filter(i => lists.some(r => r.id === i.recipe_id)).length, addX = ui.open.has("newgen");
    const body = lists.map(r => vRecipe(r, true)).join(""), L0 = lists[0];
    return `<h2 class="hrow">Suprimentos <small>${nSup}</small>${L0 ? `<span class="htools"><button class="ghost" data-act="copy-list" data-key="r-${L0.id}">Copiar</button><button class="ghost" data-act="open" data-key="bulk-r-${L0.id}" aria-expanded="${ui.open.has("bulk-r-" + L0.id)}">Responsável</button></span>` : ""}</h2>
    ${L0 ? bulkPanel("r-" + L0.id) : ""}
    <p class="hint">Limpeza e descartáveis, com quantidade. Entram em Compras, ou em Levar se alguém trouxer.</p>
    ${body || `<p class="empty">Nenhuma lista de suprimentos.</p>`}
    <h2>Uso geral <small>${plain.filter(e => e.done).length}/${plain.length}</small></h2>
    <p class="hint">Toalha, travesseiro, repelente. Toque no item para definir quem leva ou se precisa comprar.</p>
    <ul class="xlist">${plain.map(e => xRow(e)).join("") || `<li class="empty">Nada na lista ainda.</li>`}</ul>
    <div class="itools"><button class="btn sm" data-act="open" data-key="newgen" aria-expanded="${addX}">${addX ? "Fechar" : "+ Item"}</button></div>
    ${addX ? `<form class="newrow one" data-form="add-extra"><input name="item" placeholder="Item de uso geral" required><button class="btn">Adicionar</button></form>` : ""}
    ${L0 && hasCol("pendencias", "recipe_id") ? `<section class="hdoubts">${doubtsBlock(L0, "h2")}<p class="hint">Perguntas sobre a casa: o que ela já tem, o que falta levar.</p></section>` : ""}`;
  }

  function vFun() {
    const addA = ui.open.has("newact");
    return `<div class="itools"><button class="btn sm ${addA ? "" : "primary"}" data-act="open" data-key="newact" aria-expanded="${addA}">${addA ? "Fechar" : "+ Atividade"}</button></div>
    ${addA ? `<form class="newrow one" data-form="new-activity"><input name="name" placeholder="Nome da atividade" required><button class="btn">Criar</button></form>` : ""}
    ${[...S.activities].sort(byPos).map(a => {
      const open = ui.open.has(a.id), items = S.extras.filter(e => e.activity_id === a.id).sort((x, y) => (x.done - y.done) || (!x.owner - !y.owner) || String(x.owner || "").localeCompare(String(y.owner || ""), "pt") || x.item.localeCompare(y.item, "pt"));
      const nd = items.filter(e => e.done).length, ed = ui.open.has("ed-" + a.id), addI = ui.open.has("ai-" + a.id);
      return `<article class="recipe act ${open ? "open" : ""}">
        <button class="rhead chev" data-act="open" data-key="${a.id}" aria-expanded="${open}"><span><span class="rname">${esc(a.name)}</span>${a.notes && !open ? `<span class="rmeta clip">${esc(a.notes)}</span>` : ""}</span>
          ${items.length ? `<span class="rprog ${nd === items.length ? "ok" : ""}" aria-label="${nd} de ${items.length} itens resolvidos">${nd}/${items.length}</span>` : `<span class="rprog none">sem itens</span>`}</button>
        ${open ? `<div class="rbody">
          <label class="fld">Como funciona${area("activities", a.id, "notes", a.notes, "Regras, quem organiza, quando")}</label>
          <h3>O que precisa <small>${nd}/${items.length}</small></h3>
          <ul class="xlist">${items.map(e => xRow(e)).join("") || `<li class="empty">Nada ainda.</li>`}</ul>
          <div class="itools"><button class="btn sm" data-act="open" data-key="ai-${a.id}" aria-expanded="${addI}">${addI ? "Fechar" : "+ Item"}</button>
            <button class="icon" data-act="open" data-key="ed-${a.id}" aria-expanded="${ed}" aria-label="Editar nome ou excluir a atividade"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4"/></svg></button></div>
          ${addI ? `<form class="newrow one" data-form="add-extra" data-activity="${a.id}"><input name="item" placeholder="Item para comprar ou levar" required><button class="btn">Adicionar</button></form>` : ""}
          ${ed ? `<div class="rdetbox"><label class="fld">Nome${inp("activities", a.id, "name", a.name)}</label>
            <button class="btn danger" data-act="del" data-t="activities" data-id="${a.id}">Excluir atividade</button></div>` : ""}
        </div>` : ""}</article>`;
    }).join("") || `<p class="empty">Nenhuma atividade ainda. Crie a primeira acima.</p>`}`;
  }

  function vMine() {
    const names = peopleNames();
    const me = meName();
    const opts = names.some(n => norm(n) === norm(me)) || !me ? names : names.concat(me);
    if (!me) return `<p class="lead">Cadastre as pessoas do grupo em Ajustes para ver a lista de cada uma.</p><button class="btn" data-go="cfg">Abrir Ajustes</button>`;
    const tot = shopping();
    const buyAll = buyEntries(tot).filter(en => isMine(en.r.owner, me)), takeAll = takeEntries(tot).filter(en => isMine(en.r.owner, me));
    const sectors = [...new Set([...buyAll, ...takeAll].map(en => keyOf(en, "sector")))].sort((a, b) => a.localeCompare(b, "pt"));
    if (ui.mSector && !sectors.includes(ui.mSector)) ui.mSector = "";
    const buy = buyAll.filter(en => passF(en, { status: ui.mStatus, sector: ui.mSector })), take = takeAll.filter(en => passF(en, { status: ui.mStatus, sector: ui.mSector }));
    const cnt = l => `<small>${l.filter(isDone).length}/${l.length}</small>`, paid = paidSum(buyAll);
    return `<div class="shopbar">
      <div class="ptabs" role="group" aria-label="Lista de quem">${opts.map(n => `<button data-act="ui-set" data-f="me" data-v="${esc(n)}" aria-pressed="${norm(n) === norm(me)}"><i aria-hidden="true">${esc(n.trim()[0] || "?")}</i>${esc(n)}</button>`).join("")}</div>
    </div>
    <div class="frow">${seg3("mStatus", ["Tudo", "Falta", "Feito"])}${pill("mSector", "Seção", sectors.map(x => [x, x]))}</div>
    ${(bulk.set("mine-all", { name: "Lista de " + me, list: [...buyAll, ...takeAll] }), "")}<p class="minehint"><span>O que está no nome de ${esc(me)} ou marcado para todos.${paid ? ` Pago: R$ ${money.format(paid)}.` : ""}</span><button class="ghost" data-act="copy-list" data-key="mine-all">Copiar lista</button>${ui.mSector || ui.mStatus ? `<button class="ghost" data-act="clear-mine">Limpar filtros</button>` : ""}</p>
    <h2 class="sec">Comprar ${cnt(buyAll)}</h2>
    ${groupList(buy, "sector", tot, "h3", "mb") || `<p class="empty">${buyAll.length ? "Nenhuma compra com esses filtros." : "Nenhuma compra. Defina os responsáveis na aba Compras."}</p>`}
    <h2 class="sec">Levar ${cnt(takeAll)}</h2>
    ${groupList(take, "origin", tot, "h3", "mt") || `<p class="empty">${takeAll.length ? "Nenhum item com esses filtros." : "Nenhum item para levar. Defina os responsáveis na aba Levar."}</p>`}
    ${norm(me) === norm(myName()) && !noPrivate ? (pv => `<h2 class="sec">Só para mim <small>${pv.filter(p => p.done).length}/${pv.length}</small></h2>
    <p class="hint">Só você vê esta lista, em qualquer aparelho em que entrar. Boa para a sua mala.</p>
    <ul class="shop xlist plist">${pv.map(p => `<li class="prow ${p.done ? "done" : ""}">${tick("private", p.id, "done", p.done, "Feito: " + p.item)}<input data-act="set" data-t="private" data-id="${p.id}" data-f="item" value="${esc(p.item)}" aria-label="Item: ${esc(p.item)}"><button class="x" data-act="del" data-t="private" data-id="${p.id}" aria-label="Tirar ${esc(p.item)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6"/></svg></button></li>`).join("")}</ul>
    <form class="newrow one" data-form="add-private"><input name="item" placeholder="Adicionar à minha lista particular" required><button class="btn">Adicionar</button></form>`)([...S.private].sort((a, b) => (a.done - b.done) || byPos(a, b))) : ""}`;
  }

  const BK_ORDER = ["people", "ingredients", "recipes", "days", "activities", "recipe_items", "menu", "extras", "pendencias", "comments"];
  const BK_LABEL = { people: "pessoas", ingredients: "ingredientes", recipes: "receitas", days: "dias", activities: "atividades", recipe_items: "linhas de receita", menu: "pratos no cardápio", extras: "itens avulsos", pendencias: "pendências", comments: "comentários" };
  function downloadBackup(tag = "copia") {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify({ exportado_em: new Date().toISOString(), dados: Object.fromEntries(Object.entries(S).filter(([t]) => t !== "private")) }, null, 1)], { type: "application/json" }));
    a.download = `ano-novo-${tag}-${new Date().toLocaleDateString("sv")}.json`; a.click(); URL.revokeObjectURL(a.href);
  }
  async function restoreBackup() {
    const bk = ui.bk; if (!bk || bk.busy) return;
    bk.busy = true; downloadBackup("antes-de-restaurar");
    let n = 0;
    try {
      for (const t of BK_ORDER) {
        let rows = bk.data[t] || []; if (!rows.length) continue;
        if (client) {
          // só as colunas que o banco tem hoje (a cópia pode ser mais antiga ou mais nova)
          const cols = S[t][0] ? Object.keys(S[t][0]) : null;
          if (cols) rows = rows.map(r => Object.fromEntries(cols.filter(c => c in r).map(c => [c, r[c]])));
          for (let i = 0; i < rows.length; i += 200) { const { error } = await client.from(PREFIX + t).upsert(rows.slice(i, i + 200), { defaultToNull: false }); if (error) throw new Error(`${BK_LABEL[t]}: ${error.message}`); }
        } else rows.forEach(r => { const k = S[t].findIndex(x => x.id === r.id); if (k >= 0) S[t][k] = r; else S[t].push(r); });
        n += rows.length;
      }
      ui.bk = null;
      if (client) await fetchAll(); else saveLocal();
      render(true); toast(`Cópia restaurada: ${n} registros.`);
    } catch (e) { console.error(e); bk.busy = false; render(true); toast(`A restauração parou: ${e.message}. Nada foi apagado; tente de novo.`); }
  }
  function vHelp() {
    const CKS = on => `<span class="ckb${on ? " on" : ""}" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>`;
    const row = (sym, txt) => `<div><dt>${sym}</dt><dd>${txt}</dd></div>`;
    return `<p class="lead">O site junta o cardápio, as compras e o que cada pessoa leva. O que você muda aparece para o grupo na hora.</p>
    <h2>O que fazer</h2>
    <ol class="steps">
      <li><b>Confira as receitas que você conhece</b><span>Abra a receita e marque cada ingrediente que está certo, com a quantidade. Se algo estiver errado, toque no nome e ajuste.</span><button class="inl" data-go="recipes">Abrir Receitas</button></li>
      <li><b>Escolha o que você compra ou leva</b><span>Em Compras e em Levar, toque no item e ponha o seu nome. Tudo que é seu aparece junto em Minha lista.</span><button class="inl" data-go="shop">Abrir Compras</button></li>
      <li><b>Responda as pendências</b><span>São as dúvidas do grupo. As que citam o seu nome aparecem com um número no ícone de Pendências.</span><button class="inl" data-go="pend">Abrir Pendências</button></li>
    </ol>
    <h2>O que cada sinal quer dizer</h2>
    <dl class="legend">
      ${row(CKS(false) + CKS(true), "Conferência de um ingrediente. Fica verde quando alguém confirma que ele e a quantidade estão certos.")}
      ${row(`<span class="tag sug">sugestão da IA</span>`, "Quantidade estimada. Ninguém conferiu ainda.")}
      ${row(`<span class="tag new">novo</span>`, "Alguém acrescentou depois e ninguém conferiu ainda.")}
      ${row(LEAF_H, "Ingrediente da alternativa vegetariana do prato.")}
      ${row(`<span class="vflag miss">${LEAF_H}falta vegetariana</span>`, "O dia tem alguém vegetariano e nenhum prato atende. Vira <q>a conferir</q> quando existe uma opção, e <q>ok</q> depois que ela é conferida.")}
      ${row(`<i class="qdot"></i>`, "Em Compras: a quantidade vem de uma receita que ainda não foi conferida e pode mudar.")}
      ${row(`<b class="mention">@Nome</b>`, "Num comentário, escreva @ e o nome de alguém do grupo para avisar a pessoa.")}
    </dl>
    <p class="hint">Apagou algo sem querer? Fica 7 dias na lixeira, em Ajustes. Para qualquer outra dúvida, crie uma pendência.</p>`;
  }
  function vCfg() {
    const addP = ui.open.has("newperson"), CH = `<svg class="go" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>`;
    const people = `<h2>Pessoas do grupo <small>${S.people.length}</small></h2>
      <p class="hint">Os nomes que aparecem nas opções de responsável.</p>
      <ul class="plain ppl">${[...S.people].sort(byPos).map(p => `<li><i class="pav" aria-hidden="true">${esc(initials(p.name))}</i><span>${esc(p.name)}${client && norm(p.name) === norm(who) ? `<small class="you">você</small>` : ""}</span><button class="x" data-act="del" data-t="people" data-id="${p.id}" aria-label="Tirar ${esc(p.name)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6"/></svg></button></li>`).join("")}</ul>
      <div class="itools"><button class="btn sm" data-act="open" data-key="newperson" aria-expanded="${addP}">${addP ? "Fechar" : "+ Pessoa"}</button></div>
      ${addP ? `<form class="newrow one" data-form="add-person"><input name="name" placeholder="Nome da pessoa" required><button class="btn">Adicionar</button></form>` : ""}`;
    return `${people}
    <h2>Cópia e exportação</h2>
    <div class="actlist">
      <button class="actrow" data-act="backup"><span><b>Baixar cópia de segurança</b><small>Guarda tudo num arquivo, menos as listas particulares.</small></span>${CH}</button>
      <button class="actrow" data-act="xlsx"><span><b>Exportar planilha</b><small>Compras, o que levar, cardápio, receitas e pendências.</small></span>${CH}</button>
      <label class="actrow filebtn"><span><b>Restaurar de uma cópia</b><small>Traz de volta o que foi apagado ou alterado depois dela.</small></span>${CH}<input type="file" id="bk-file" class="sr" accept="application/json,.json"></label>
    </div>
    ${ui.bk ? `<div class="bkbox" role="group" aria-label="Restaurar cópia de segurança">
      <p><b>${esc(ui.bk.name)}</b>, feita em ${esc(fmtWhen(ui.bk.when) || "data desconhecida")}.</p>
      <p>${BK_ORDER.map(t => `${(ui.bk.data[t] || []).length} ${BK_LABEL[t]}`).join(", ")}.</p>
      <p class="hint">Restaurar traz de volta o que foi apagado e desfaz as alterações feitas depois dessa cópia. O que foi criado depois dela continua no site. Antes de restaurar, o site baixa uma cópia do estado atual.</p>
      <div class="newrow"><button class="btn primary" data-act="bk-restore" ${ui.bk.busy ? "disabled" : ""}>${ui.bk.busy ? "Restaurando…" : "Restaurar agora"}</button>${ui.bk.busy ? "" : `<button class="ghost" data-act="bk-cancel">Cancelar</button>`}</div></div>` : ""}
    ${(o => o.length ? `<h2>Ingredientes sem receita <small>${o.length}</small></h2>
    <p class="hint">Sobraram de receitas alteradas e nenhuma receita usa. Não aparecem em lista nenhuma; pode excluir.</p>
    <ul class="plain">${o.map(i => `<li><span>${esc(i.name)}</span><button class="ghost" data-act="del" data-t="ingredients" data-id="${i.id}">Excluir</button></li>`).join("")}</ul>` : "")(S.ingredients.filter(i => !S.recipe_items.some(x => x.ingredient_id === i.id) && !S.trash.some(t => ((t.payload || {}).recipe_items || []).some(x => x.ingredient_id === i.id))).sort((a, b) => a.name.localeCompare(b.name, "pt")))}
    ${noTrash ? "" : `<h2>Lixeira <small>${S.trash.length}</small></h2>
    <p class="hint">O que foi excluído fica aqui por 7 dias e pode voltar.</p>
    ${S.trash.length ? `<ul class="plain">${[...S.trash].sort((a, b) => String(b.deleted_at).localeCompare(String(a.deleted_at))).map(t => `<li><span>${esc(t.label)} <small class="note">${KIND[t.tbl] || ""}${t.deleted_by ? ", excluído por " + esc(t.deleted_by) : ""}</small></span><button class="ghost" data-act="restore" data-id="${t.id}">Restaurar</button></li>`).join("")}</ul>` : `<p class="empty">Nada na lixeira.</p>`}`}
    ${client ? `<h2>Sair</h2><div class="actlist"><button class="actrow out" data-act="logout"><span><b>Sair deste aparelho</b><small>Você entrou como ${esc(who)}. O login fica salvo aqui até sair.</small></span>${CH}</button></div>` : ""}`;
  }

  const MORE = `<button class="more-btn" data-act="scroll-right" aria-label="Ver mais"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></button><button class="more-btn back" data-act="scroll-left" aria-label="Voltar"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button>`;
  function markScroll() {
    view.querySelectorAll(".hbox").forEach(b => {
      const sc = b.firstElementChild, upd = () => { b.classList.toggle("can-next", sc.scrollWidth - sc.clientWidth - sc.scrollLeft > 8); b.classList.toggle("can-prev", sc.scrollLeft > 24); };
      upd(); sc.addEventListener("scroll", upd, { passive: true });
    });
  }
  function vStart() {
    const tot = shopping(), buy = buyEntries(tot), take = takeEntries(tot), me = meName();
    const mine = [...buy, ...take].filter(en => isMine(en.r.owner, me));
    const days = [...S.days].sort((a, b) => a.date.localeCompare(b.date));
    let n = null;
    if (days[0]) { const [y, m, dd] = days[0].date.split("-").map(Number); n = Math.ceil((new Date(y, m - 1, dd) - new Date().setHours(0, 0, 0, 0)) / 864e5); }
    const next = WHEN.map(w => [w, buy.filter(en => keyOf(en, "when_buy") === w && !isDone(en)).length]).find(([, c]) => c);
    const act = S.recipes.filter(r => recipeCount(r) && r.block !== "Casa"), open = S.pendencias.filter(p => !p.done).length;
    const nextIds = new Set(next ? buy.filter(en => en.k === "i" && keyOf(en, "when_buy") === next[0] && !isDone(en)).map(en => en.r.id) : []);
    const buyNo = buy.filter(en => !en.r.owner && !isDone(en)).length, takeNo = take.filter(en => !en.r.owner && !isDone(en)).length;
    const todo = new Map();
    S.recipe_items.forEach(it => { if (!nextIds.has(it.ingredient_id)) return; const r = get("recipes", it.recipe_id); if (r && !isRev(r) && recipeCount(r) && !(CK() && isChk(it))) todo.set(r.id, (todo.get(r.id) || 0) + 1); });
    const cnt = (l, f) => l.filter(f).length;
    // quase tudo sem dono ainda: convite neutro; sobrando poucos: alerta com o número
    const noOwner = (n, total) => !n ? "" : n > total / 2 ? `<span class="tile-a soft">Distribuir responsáveis</span>` : `<span class="tile-a">${n} sem responsável</span>`;
    const tile = (tab, sec, title, big, small, sub, cls = "", alert = "") => `<button class="tile ${cls}" data-go="${tab}" data-sec="${sec}"><span class="tile-t">${title}</span><span class="tile-n">${big}<i>${small}</i></span><span class="tile-s">${sub}</span>${alert}${typeof small === "string" && small[0] === "/" && Number(small.slice(1)) ? `<span class="tile-bar" aria-hidden="true"><i style="width:${Math.round(100 * big / Number(small.slice(1)))}%"></i></span>` : ""}</button>`;
    const waves = [0, 1, 2, 3, 4, 5, 6].map(k => { const y = 10 + k * 12, a = k % 2 ? 7 : -7; return `<path d="M-20 ${y} C 60 ${y + a}, 140 ${y - a}, 220 ${y} S 380 ${y + a}, 460 ${y} S 620 ${y - a}, 700 ${y} S 860 ${y + a}, 940 ${y}"/>`; }).join("");
    return `<section class="hero">
      <div class="top-row"><span class="hbrand"><b>Ano Novo 26/27</b><small>${days.length ? (f => `${f(days[0].date)} a ${f(days[days.length - 1].date)}`)(d => { const [, m, dd] = d.split("-").map(Number); return `${dd} de ${["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"][m - 1]}`; }) : ""}</small></span>${acct()}</div>
      ${n === null ? "" : n > 0 ? `<p class="count"><b>${n}</b><span>${n === 1 ? "dia para" : "dias para"}<br>a viagem</span></p>` : `<p class="count"><b>Já</b><span>estamos<br>na viagem</span></p>`}
      <svg class="waves7" viewBox="0 0 900 96" preserveAspectRatio="none" aria-hidden="true">${waves}</svg>
    </section>
    <h2 class="vh">Cardápio da semana</h2>
    <div class="hbox"><div class="strip">${days.map(d => { const L = dayLabel(d, true), ds = S.menu.filter(m => m.day_id === d.id).sort(byPos).map(m => get("recipes", m.recipe_id)).filter(Boolean);
      return `<button class="sday ${d.veg_guest ? "veg" : ""}" data-act="goto-day" data-id="${d.id}"><span class="sd-h"><b>${L.dd}</b><span>${L.wk}</span></span>${ds.length ? byCat(ds).map(([b, l]) => b === "Jantar" ? `<em class="main">${esc(l.map(r => short(r.name)).join(", "))}</em>`
        : `<small class="cat">${esc(b)}</small><em>${esc(l.map(r => short(r.name)).join(", "))}</em>`).join("") : `<em class="none">sem prato</em>`}${d.veg_guest ? (st => `<span class="vflag ${st}">${LEAF_H}${st === "ok" ? "vegetariana ok" : st === "pend" ? "vegetariana a conferir" : "falta vegetariana"}</span>`)(dayVegState(d)) : ""}</button>`; }).join("")}</div>${MORE}</div>
    ${next ? `<div class="nextbuy"><button class="nb-main" data-go="shop"><span>Próxima leva de compras</span><strong>${esc(next[0])}</strong><em>${next[1]} ${next[1] === 1 ? "item por comprar" : "itens por comprar"}</em></button>
      ${todo.size ? `<button class="nb-sub chev" data-act="open" data-key="todo" aria-expanded="${ui.open.has("todo")}">Antes, conferir ${todo.size} ${todo.size === 1 ? "receita" : "receitas"}</button>` : `<span class="nb-ok">As receitas dessa leva já foram conferidas.</span>`}</div>
    ${todo.size && ui.open.has("todo") ? `<ul class="plain">${[...todo].map(([id, c]) => `<li><button class="rowlink" data-act="open-recipe" data-id="${id}">${esc(get("recipes", id).name)}<small>${c} ${c === 1 ? "item" : "itens"} nessa leva</small></button></li>`).join("")}</ul>` : ""}` : ""}
    <div class="tiles">
      ${tile("shop", "compras", "Compras", cnt(buy, isDone), `/${buy.length}`, "itens comprados", "", noOwner(buyNo, buy.length))}
      ${tile("take", "levar", "Levar", cnt(take, isDone), `/${take.length}`, "itens separados", "", noOwner(takeNo, take.length))}
      ${tile("mine", "minha", "Minha lista", cnt(mine, isDone), `/${mine.length}`, me ? `itens de ${esc(me)}` : "sem pessoa definida")}
      ${tile("pend", "pend", "Pendências", open, "", "em aberto", "", (n => n ? `<span class="tile-a">${n === 1 ? "1 marca você" : n + " marcam você"}</span>` : "")(S.pendencias.filter(tagsMe).length))}
      ${tile("recipes", "plano", "Receitas conferidas", cnt(act, isRev), `/${act.length}`, "confira antes de alguém comprar", "wide")}
    </div>
    <p class="helplink"><button class="ghost" data-go="help">Como funciona o site</button></p>
`;
  }

  function filterShop() {
    const k = norm(ui.q);
    view.querySelectorAll("section.grp").forEach(sec => {
      const ul = sec.querySelector("ul"); let hit = 0;
      ul.querySelectorAll(":scope > li[data-name]").forEach(li => { li.hidden = !!k && !li.dataset.name.includes(k); if (!li.hidden) hit++; });
      ul.hidden = k ? false : ul.dataset.closed === "1";
      sec.hidden = !!k && !hit;
    });
  }

  /* ---------- texto -> ingredientes, e exportação ---------- */
  const UNITS = { g: "g", gr: "g", grama: "g", gramas: "g", kg: "kg", quilo: "kg", quilos: "kg", ml: "ml", l: "L", litro: "L", litros: "L", un: "un", unidade: "un", unidades: "un",
    lata: "lata", latas: "lata", pacote: "pacote", pacotes: "pacote", garrafa: "garrafa", garrafas: "garrafa", caixa: "caixa", caixas: "caixa", pote: "pote", potes: "pote",
    "maço": "maço", "maços": "maço", dente: "dente", dentes: "dente", colher: "colher", colheres: "colher", "xícara": "xícara", "xícaras": "xícara", fatia: "fatia", fatias: "fatia",
    saco: "saco", sacos: "saco", "pé": "pé", "pés": "pé", vidro: "vidro", vidros: "vidro", bandeja: "bandeja", bandejas: "bandeja" };
  function parseLine(line) {
    let t = line.replace(/^[\s\-•*]+/, "").trim(); if (!t) return null;
    let qty = 0, unit = "";
    const m = t.match(/^(\d+(?:[.,]\d+)?(?:\s*\/\s*\d+)?)\s*(.*)$/);
    if (m) {
      const pf = x => parseFloat(String(x).replace(",", ".")) || 0, [a, b] = m[1].split("/");
      qty = b ? pf(a) / (pf(b) || 1) : pf(a); t = m[2];
      const w = t.split(/\s+/)[0] || "", u = UNITS[w.toLowerCase().replace(/\.$/, "")];
      if (u) { unit = u; t = t.slice(w.length).trim().replace(/^(de|do|da)\s+/i, ""); }
    }
    return t ? { name: t[0].toUpperCase() + t.slice(1), qty, unit } : null;
  }
  async function exportXlsx() {
    if (!window.XLSX) {
      toast("Preparando a planilha…");
      try { await new Promise((ok, no) => { const sc = document.createElement("script"); sc.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"; sc.onload = ok; sc.onerror = no; document.head.append(sc); }); }
      catch { return toast("Não foi possível baixar o gerador de planilha. Confira a conexão."); }
    }
    const X = window.XLSX, tot = shopping(), sn = b => (b ? "sim" : "não");
    const itemRow = en => en.k === "r" ? [en.r.name + " (receita pronta)", "", "", "", "", "", en.r.owner || "", sn(en.r.brought_done), "", 0, ""] : en.k === "i"
      ? [en.r.name, (tot.get(en.r.id) || {}).qty || 0, en.r.unit, secOf(en.r), isHome(en.r) ? "" : realWhen(en.r), en.r.store || "", en.r.owner || "", sn(en.r.bought), en.r.bought_by || "", Number(en.r.paid) || 0, en.r.note || "", sn(isBF(en.r))]
      : [en.r.item, "", "", keyOf(en, "sector"), "", en.r.store || "", en.r.owner || "", sn(en.r.done), en.r.bought_by || "", Number(en.r.paid) || 0, ""];
    const head = ["Item", "Quantidade", "Unidade", "Seção", "Momento", "Loja", "Responsável", "Feito", "Quem pagou", "Valor pago", "Observação", "Black Friday"];
    const days = [...S.days].sort((a, b) => a.date.localeCompare(b.date));
    const sheets = {
      "Compras": [head, ...buyEntries(tot).map(itemRow)],
      "Levar": [head, ...takeEntries(tot).map(itemRow)],
      "Cardápio": [["Dia", "Pratos", "Pessoas", "Precisa de opção vegetariana", "Café da manhã", "Observações"], ...days.map(d => [dayLabel(d), byCat(S.menu.filter(m => m.day_id === d.id).map(m => get("recipes", m.recipe_id)).filter(Boolean)).map(([b, l]) => `${b}: ${l.map(r => r.name).join(", ")}`).join("; "), d.people, sn(d.veg_guest), sn(d.breakfast), d.notes || ""])],
      "Receitas": [["Receita", "Tipo", "No cardápio", "Receita conferida", "Ingrediente", "Quantidade", "Unidade", "Observação", "Conferido por", "Alternativa vegetariana", "De onde vem"], ...S.recipes.slice().sort(byPos).flatMap(r => S.recipe_items.filter(i => i.recipe_id === r.id).sort(byPos).map(i => { const g = get("ingredients", i.ingredient_id) || {}; return [r.name, r.block, recipeStatus(r).text, sn(isRev(r)), g.name || "", i.qty || 0, g.unit || "", i.note || "", checkers(i).join(", "), sn(i.veg === "sim"), isAtHouse(g) ? "Já tem na casa" : isHome(g) ? "Responsável leva" : "Comprar"]; }))],
      "Pendências": [["Tipo", "Assunto", "Detalhe", "Resolvida", "Receita", "Conversa"], ...S.pendencias.map(p => [p.kind, p.subject, p.detail, sn(p.done), (get("recipes", p.recipe_id) || {}).name || "", [p.answer, ...S.comments.filter(c => c.pend_id === p.id).map(c => `${c.author}: ${c.body}`)].filter(Boolean).join(" | ")])],
    };
    const wb = X.utils.book_new();
    for (const [name, rows] of Object.entries(sheets)) X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(rows), name);
    X.writeFile(wb, `ano-novo-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  /* ---------- ações ---------- */
  const num = v => { const n = parseFloat(String(v).replace(/\./g, "").replace(",", ".")); return Number.isFinite(n) ? n : 0; };
  const GUESS = [["Congelados", /congelad|sorvete|guioza|rolinho|polpa/], ["Padaria", /^pao|pao de|torrad|bolo/],
    ["Bebidas", /cerveja|vinho|espumante|vodka|rum|sake|refrigerante|^suco|agua|coca|sprite|gelo|aperol|gin\b|tonica|energetico|cachaca|whisky|tequila|licor/],
    ["Mercearia", /em po|em conserva|enlatad|\(lata\)|molho|extrato|geleia|suco em|seco|seca|desidratad|oleo|azeite|vinagre|farinha|acucar|\bsal\b|tempero pronto|pasta de|leite de coco|coco ralado|macarrao|massa|crispy|frita|chips/],
    ["Hortifruti", /tomate|cebola|alho|alface|rucula|coentro|salsa|cebolinha|batata|cenoura|limao|laranja|abacate|pepino|repolho|fruta|banana|morango|pimentao|abobrinha|berinjela|legume|verdura|manjericao|hortela|abacaxi|melancia|melao|mamao|maracuja|pessego|ameixa|goiaba|tangerina|mexerica|framboesa|mirtilo|cereja|acerola|lichia|pitaya|brocolis|espinafre|agriao|acelga|chicoria|escarola|abobora|chuchu|quiabo|vagem|ervilha fresca|milho verde|mandioca|aipim|inhame|beterraba|rabanete|gengibre|pimenta dedo|pimenta fresca|cogumelo|shimeji|shitake|champignon fresco|alho-poro|alho poro|salsao|erva-doce|alecrim|tomilho|louro fresco|salvia|endro|rucula|folhas|\b(manga|maca|pera|uva|kiwi|figo|coco|caju|nabo|amora|dill|aipo|couve|broto)s?\b/],
    ["Açougue e peixaria", /carne|frango|linguica|bacon|peixe|salmao|costela|picanha|sobrecoxa|peito|camarao|file/],
    ["Frios e laticínios", /queijo|leite|iogurte|manteiga|requeijao|creme de leite|cream cheese|presunto|salame|ricota|mussarela|ovo/],
    ["Casa e descartáveis", /papel|detergente|guardanapo|saco de lixo|copo|descartavel|carvao|esponja/]];
  const guessRaw = name => { const k = norm(name); return (GUESS.find(([, re]) => re.test(k)) || [""])[0]; };
  const guessSector = name => guessRaw(name) || "Mercearia";
  function ensureIngredient(name, unit, sector) {
    const found = findIng(name); if (found) return found;
    const ing = { id: uid(), name: name.trim(), unit: (unit || "un").trim() || "un", sector: sector || guessSector(name), when_buy: "Antes da viagem", buy_hint: "", bought: false, from_home: false, owner: "", note: "" };
    S.ingredients.push(ing); persist("ingredients", ing);
    toast(`Ingrediente novo: ${ing.name}, em ${ing.sector}.`);
    return ing;
  }

  view.addEventListener("change", e => {
    const el = e.target, act = el.dataset.act;
    if (el.id === "bk-file") {
      const file = el.files && el.files[0]; if (!file) return;
      return void file.text().then(txt => {
        const j = JSON.parse(txt), data = j && j.dados;
        if (!data || !Array.isArray(data.recipes) || !Array.isArray(data.ingredients)) throw new Error("formato");
        ui.bk = { name: file.name, when: j.exportado_em, data }; render(true);
      }).catch(() => { ui.bk = null; render(true); toast("Esse arquivo não é uma cópia de segurança deste site."); });
    }
    if (act === "plan") {
      const g = get("ingredients", el.dataset.id), v = el.value; if (!g) return;
      const patch = { from_home: v === "take" }; if (hasHouse()) patch.at_house = v === "house";
      if (v.startsWith("w:")) patch.when_buy = v.slice(2); else if (g.when_buy === HOME) patch.when_buy = "A definir";
      const was = isAtHouse(g) ? "house" : isHome(g) ? "take" : "buy", now = v.startsWith("w:") ? "buy" : v;
      if (was !== now) toast(now === "buy" ? "Foi para a lista de compras." : now === "take" ? (g.owner ? "Foi para a lista de levar." : "Foi para a lista de levar. Falta definir quem leva.") : "Já tem na casa: saiu das listas.");
      return update("ingredients", g.id, patch, true);
    }
    if (el.name === "sector" && el.closest(".secpick")) { el.dataset.touched = "1"; el.closest(".secpick").classList.toggle("ask", !el.value); }
    if (!act) return;
    const force = el.type === "checkbox" || el.tagName === "SELECT";
    if (act === "set") {
      const { t, id, f } = el.dataset;
      let v = el.type === "checkbox" ? el.checked : el.dataset.num ? num(el.value) : el.type === "number" ? (parseInt(el.value, 10) || 0) : el.value;
      const patch = { [f]: v };
      if (t === "private" && f === "item" && !String(v).trim()) return render(true);
      if (t === "recipe_items" && f === "qty" && !CK()) patch.suggested = false;
      if (t === "ingredients" && f === "name") {
        v = v.trim(); const dup = findIng(v);
        if (!v || (dup && dup.id !== id)) { toast(v ? `Já existe um ingrediente chamado ${dup.name}.` : "O nome não pode ficar vazio."); return render(true); }
        patch.name = v;
      }
      if (["recipes", "extras", "activities"].includes(t) && (f === "name" || f === "item") && !String(v).trim()) return render(true);
      const cur = get(t, id) || {};
      if (t === "ingredients" && f === "bought" && hasCol(t, "bought_by")) patch.bought_by = v ? (cur.bought_by || who) : "";
      if (t === "extras" && f === "done" && cur.buy && hasCol(t, "bought_by")) patch.bought_by = v ? (cur.bought_by || who) : "";
      if (t === "ingredients" && f === "buy_hint" && hasCol(t, "hint_qty")) patch.hint_qty = (shopping().get(id) || {}).qty ?? null;
      if (t === "ingredients" && f === "unit") { patch.unit = String(v).trim() || "un"; const n = new Set(S.recipe_items.filter(i => i.ingredient_id === id).map(i => i.recipe_id)).size; if (n > 1) toast(`A unidade mudou neste ingrediente em todas as ${n} receitas que usam ele.`); }
      if (t === "ingredients" && f === "bf" && !v && (get(t, id) || {}).when_buy === BF) patch.when_buy = "Antes da viagem";
      if (ui.tab !== "fun" && ((t === "extras" && f === "buy") || (t === "ingredients" && f === "from_home"))) toast((t === "extras") === !!v ? "Foi para a lista de compras." : "Foi para a lista de levar.");
      update(t, id, patch, force);
    } else if (act === "owner") {
      const { t, id, name } = el.dataset, row = get(t, id); if (!row) return;
      let v;
      if (name === "Todos") v = el.checked ? "Todos" : "";
      else {
        const cur = owners(row.owner).filter(n => n !== "Todos" && n !== name);
        if (el.checked) cur.push(name);
        const order = peopleNames();
        v = cur.sort((a, b) => ((order.indexOf(a) + 999) % 999) - ((order.indexOf(b) + 999) % 999)).join(", ");
      }
      update(t, id, { owner: v }, true);
    } else if (act === "weekly-sw") {
      const r = get("recipes", el.dataset.id); if (!r) return;
      if (!el.checked) S.menu.filter(m => m.recipe_id === r.id).forEach(m => { removeLocal("menu", m.id); persistDelete("menu", m.id); });
      toast(el.checked ? `${r.name} entrou no cardápio da semana.` : `${r.name} saiu do cardápio, de todos os dias e das compras.`); update("recipes", r.id, { weekly: el.checked }, true);
    } else if (act === "cups") {
      const it = get("recipe_items", el.dataset.id), ing = it && get("ingredients", it.ingredient_id), d = dens(ing), n = parseFloat(String(el.value).replace(",", "."));
      if (!d || !(n > 0)) return render(true);
      const q = Math.round(n * d); toast(`${nf.format(n)} ${n <= 1 ? "xícara" : "xícaras"} de ${ing.name}: ${q} ${ing.unit}.`); update("recipe_items", it.id, CK() ? { qty: q } : { qty: q, suggested: false }, true);
    } else if (act === "repoint") {
      const it = get("recipe_items", el.dataset.id), name = el.value.trim();
      if (!it || !name) return render(true);
      const cur = get("ingredients", it.ingredient_id);
      if (cur && cur.name === name) return;
      // só mudou maiúscula ou acento, ou o nome é novo e o ingrediente só existe nesta linha: renomeia o próprio ingrediente
      const alone = cur && S.recipe_items.filter(i => i.ingredient_id === cur.id).length === 1;
      if (cur && (norm(cur.name) === norm(name) || (alone && !findIng(name)))) return update("ingredients", cur.id, { name }, true);
      const ing = ensureIngredient(name, cur && cur.unit);
      update("recipe_items", it.id, { ingredient_id: ing.id }, true);
    } else if (act === "menu-add") {
      if (el.value) add("menu", { id: uid(), day_id: el.dataset.day, recipe_id: el.value, pos: nextPos("menu") });
    } else if (act === "ui") {
      ui[el.dataset.f] = el.type === "checkbox" ? el.checked : el.value; render(true);
    }
  });
  view.addEventListener("input", e => {
    const el = e.target;
    if (el.id === "shop-q") { ui.q = el.value; filterShop(); }
    if (el.id === "rec-q") { ui.rq = el.value; filterRecipes(); }
    if (el.id === "pend-q") { const k = norm(el.value); view.querySelectorAll(".pgrp").forEach(g => { let n = 0; g.querySelectorAll(":scope > .pend > li").forEach(li => { li.hidden = !!k && !li.dataset.txt.includes(k); n += !li.hidden; }); g.hidden = !n; }); }
    if (el.classList.contains("lk-q")) { const k = norm(el.value); el.parentNode.querySelectorAll("[data-name]").forEach(b => { b.hidden = !!k && !b.dataset.name.includes(k); }); }
    if (el.dataset.act === "ing-hint") {
      const u = el.form.elements.unit, g = findIng(el.value);
      // sugere a unidade da lista, sem travar: quem escreveu outra unidade fica com a sua
      if (!u.value || u.dataset.auto === u.value) u.value = g ? g.unit : "";
      u.dataset.auto = g ? g.unit : "";
      // ingrediente novo: mostra a seção com o palpite; sem palpite, pede para escolher
      const sp = el.form.querySelector(".secpick"), ss = sp && sp.querySelector("select");
      if (sp) { const isNew = !g && el.value.trim().length > 1; sp.hidden = !isNew; if (isNew && !ss.dataset.touched) ss.value = guessRaw(el.value); sp.classList.toggle("ask", isNew && !ss.value); }
    }
  });
  function closeSheet() {
    const id = ui.sheet; if (!id) return;
    ui.sheet = null; render(true);
    const b = view.querySelector(`[data-act="sheet-day"][data-id="${id}"]`); if (b) b.focus();   // devolve o foco ao dia de origem
  }
  document.addEventListener("click", e => { if (ui.open.has("acct") && !e.target.closest(".acctbox")) { ui.open.delete("acct"); render(true); } }, true);
  document.addEventListener("keydown", e => { if (e.key !== "Escape" || sugFor) return; if (ui.open.has("acct")) { ui.open.delete("acct"); return render(true); } if (ui.sheet) closeSheet(); else if (ui.fsheet) { ui.fsheet = false; render(true); } });

  // Sugestões próprias: o <datalist> do navegador não abre no Android.
  const SUG_UNITS = ["g", "kg", "ml", "L", "un", "xícara", "colher de sopa", "lata", "pacote", "maço", "garrafa", "caixa"];
  const sugBox = document.createElement("div"); sugBox.className = "sugbox"; sugBox.hidden = true; sugBox.setAttribute("role", "listbox"); document.body.appendChild(sugBox);
  let sugFor = null;
  const sugSrc = kind => kind === "ings" ? S.ingredients.map(i => i.name)
    : kind === "stores" ? [...new Set([...S.ingredients, ...S.extras].map(i => i.store).filter(Boolean))]
    : kind === "sectors" ? [...new Set(SECTORS.concat(S.ingredients.map(secOf).filter(Boolean)))]
    : [...new Set(SUG_UNITS.concat(S.ingredients.map(i => i.unit).filter(Boolean)))];
  function sugHide() { sugBox.hidden = true; sugFor = null; }
  function sugShow(el) {
    const kind = el.dataset.sug, k = norm(el.value);
    if (kind === "mention") {
      const m = el.value.match(/@([^\s@]*)$/); if (!m) return sugHide();
      const names = peopleNames().filter(n => norm(n).startsWith(norm(m[1]))); if (!names.length) return sugHide();
      sugBox.innerHTML = names.map(o => `<button type="button" role="option" data-v="${esc(o)}">@${esc(o)}</button>`).join("");
      const r = el.getBoundingClientRect();
      sugBox.style.left = Math.max(8, Math.min(r.left, innerWidth - 188)) + scrollX + "px"; sugBox.style.top = r.bottom + scrollY + 4 + "px"; sugBox.style.minWidth = "180px";
      sugBox.hidden = false; sugFor = el; return;
    }
    if (kind === "ings" && !k) return sugHide();               // ingrediente: só sugere depois de digitar
    const seen = new Set(); let list = sugSrc(kind).filter(o => { const n = norm(o); return !seen.has(n) && seen.add(n); });
    // unidade, loja e seção abrem com tudo; ao digitar algo diferente do que já estava, filtram
    const typed = k && el.dataset.sugTyped === "1";
    if (kind === "ings" || typed) list = list.filter(o => norm(o).includes(k)).sort((a, b) => (norm(b).startsWith(k) - norm(a).startsWith(k)) || a.localeCompare(b, "pt"));
    else list = kind === "units" ? list : list.sort((a, b) => a.localeCompare(b, "pt"));
    list = list.filter(o => norm(o) !== k || !typed && kind !== "ings").slice(0, kind === "ings" ? 8 : 30);
    if (!list.length) return sugHide();
    sugBox.innerHTML = list.map(o => `<button type="button" role="option" data-v="${esc(o)}"${norm(o) === k ? ' aria-selected="true"' : ""}>${esc(o)}</button>`).join("");
    const r = el.getBoundingClientRect();
    sugBox.style.left = Math.max(8, Math.min(r.left, innerWidth - 8 - Math.max(r.width, 180))) + scrollX + "px";
    sugBox.style.top = r.bottom + scrollY + 4 + "px"; sugBox.style.minWidth = Math.max(r.width, 180) + "px";
    sugBox.hidden = false; sugFor = el;
  }
  document.addEventListener("focusin", e => { const el = e.target; if (el.dataset && el.dataset.sug) { el.dataset.sugTyped = ""; sugShow(el); } });
  document.addEventListener("input", e => { const el = e.target; if (el.dataset && el.dataset.sug) { el.dataset.sugTyped = "1"; sugShow(el); } });
  document.addEventListener("focusout", e => { if (e.target === sugFor) setTimeout(() => { if (document.activeElement !== sugFor) sugHide(); }, 200); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && sugFor) sugHide(); });
  document.addEventListener("click", e => { const el = e.target; if (el.dataset && el.dataset.sug && sugBox.hidden) { el.dataset.sugTyped = ""; sugShow(el); } });
  document.addEventListener("pointerdown", e => { if (sugFor && e.target !== sugFor && !sugBox.contains(e.target)) sugHide(); });
  sugBox.addEventListener("pointerdown", e => e.preventDefault());   // não tira o foco do campo
  sugBox.addEventListener("click", e => {
    const b = e.target.closest("button"), el = sugFor; if (!b || !el) return;
    if (!el.isConnected) return sugHide();
    if (el.dataset.sug === "mention") { el.value = el.value.replace(/@([^\s@]*)$/, "@" + b.dataset.v + " "); sugHide(); return el.focus(); }
    el.value = b.dataset.v; sugHide();
    el.dispatchEvent(new Event("input", { bubbles: true })); sugHide();
    if (el.dataset.act && el.dataset.act !== "ing-hint") el.dispatchEvent(new Event("change", { bubbles: true }));
    else { const f = el.form, nx = f && [...f.elements].find(x => x !== el && x.tagName === "INPUT" && !x.value); if (nx) nx.focus(); }
  });

  view.addEventListener("focusout", () => setTimeout(() => { if (renderPending) render(false); }, 350));
  document.addEventListener("click", e => {
    const g = e.target.closest("[data-go]"); if (g) return go(g.dataset.go);
    const el = e.target.closest("[data-act]"); if (!el || /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return;
    const act = el.dataset.act;
    if (act === "open") { const k = el.dataset.key; ui.open.has(k) ? ui.open.delete(k) : ui.open.add(k); render(true); }
    else if (act === "back") { ui.back = null; go("menu"); }
    else if (act === "open-recipe") { [...ui.open].filter(k => /^(cm-|ep-|ec-|lk-|own-|x-|q-|bulk-)/.test(k)).forEach(k => ui.open.delete(k)); ui.sheet = null; ui.rq = ui.rBlock = ui.rIn = ui.rRev = ""; ui.back = ui.tab === "menu" ? el.dataset.id : null; ui.tab = (get("recipes", el.dataset.id) || {}).block === "Casa" ? "home" : "recipes"; ui.rec = el.dataset.id; render(true); window.scrollTo(0, 0); }
    else if (act === "scroll-right" || act === "scroll-left") { const sc = el.parentNode.firstElementChild; sc.scrollBy({ left: sc.clientWidth * 0.8 * (act === "scroll-left" ? -1 : 1), behavior: "smooth" }); }
    else if (act === "rec-open") { ui.rec = el.dataset.id; ui.back = null; render(true); window.scrollTo(0, 0); }
    else if (act === "rec-close") { ui.rec = null; render(true); }
    else if (act === "pend-link") { const r = get("recipes", el.dataset.r); if (r) { ui.open.delete("lk-" + el.dataset.id); toast(`A pendência foi para a receita ${r.name}.`); update("pendencias", el.dataset.id, { recipe_id: r.id }, true); } }
    else if (act === "del") remove(el.dataset.t, el.dataset.id);
    else if (act === "bulk-owner") {
      const b = bulk.get(el.dataset.key), who2 = el.closest(".bulk").querySelector("select").value; if (!b) return;
      let n = 0;
      b.list.forEach(en => { if (el.dataset.mode === "all" || !en.r.owner) { en.r.owner = who2; persistPatch(tableOf(en), en.r.id, { owner: who2 }); n++; } });
      ui.open.delete("bulk-" + el.dataset.key); render(true); toast(`${who2} agora é responsável por ${n} ${n === 1 ? "item" : "itens"}.`);
    }
    else if (act === "copy-list") {
      const b = bulk.get(el.dataset.key); if (!b) return;
      const tot = shopping(), rid = el.dataset.key.startsWith("r-") ? el.dataset.key.slice(2) : null;
      const todo2 = rid ? b.list : b.list.filter(en => !isDone(en));
      const qtyOf = en => rid ? S.recipe_items.filter(i => i.recipe_id === rid && i.ingredient_id === en.r.id).reduce((a, i) => a + (Number(i.qty) || 0), 0) : (tot.get(en.r.id) || {}).qty;
      const line = en => en.k === "i" ? `- ${en.r.name}: ${fmtQty(qtyOf(en), en.r.unit)}${en.r.buy_hint ? ` (${en.r.buy_hint})` : ""}` : en.k === "r" ? `- ${en.r.name} (pronto)` : `- ${en.r.item}`;
      const text = `${b.name}\n${todo2.map(line).join("\n")}`;
      (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => toast(`Lista copiada: ${todo2.length} ${todo2.length === 1 ? "item" : "itens"}${rid ? "" : " que faltam"}.`), () => toast("Não foi possível copiar neste navegador."));
    }
    else if (act === "backup") downloadBackup();
    else if (act === "bk-cancel") { ui.bk = null; render(true); }
    else if (act === "bk-restore") { el.disabled = true; el.textContent = "Restaurando…"; restoreBackup(); }
    else if (act === "xlsx") exportXlsx();
    else if (act === "restore") { $("#toast").classList.remove("on"); restore(el.dataset.id); }
    else if (act === "pend-out") update("pendencias", el.dataset.id, { recipe_id: null }, true);
    else if (act === "toggle-bf") { const d = get("days", el.dataset.d); if (d) update("days", d.id, { breakfast: !d.breakfast }, true); }
    else if (act === "toggle-day") {
      const m = S.menu.find(x => x.day_id === el.dataset.d && x.recipe_id === el.dataset.r);
      if (m) remove("menu", m.id); else add("menu", { id: uid(), day_id: el.dataset.d, recipe_id: el.dataset.r, pos: nextPos("menu") });
    }
    else if (act === "weekly") { const r = get("recipes", el.dataset.id), on = el.dataset.v === "1"; if (r) { toast(on ? `${r.name} entrou na semana toda.` : `${r.name} virou ideia e saiu das compras.`); update("recipes", r.id, { weekly: on }, true); } }
    else if (act === "unhouse") update("ingredients", el.dataset.id, { at_house: false, from_home: false }, true);
    else if (act === "check") {
      const it = get("recipe_items", el.dataset.id); if (!it) return;
      const me = who || "eu", by = checkers(it), has = by.some(n => norm(n) === norm(me));
      const ph = n => norm(n) === "caderno", onlyPh = by.length > 0 && by.every(ph);
      // só o marcador da importação: o toque desmarca; com o meu nome: sai o meu nome e o marcador; senão entra o meu nome
      update("recipe_items", it.id, { checked_by: (onlyPh ? [] : has ? by.filter(n => norm(n) !== norm(me) && !ph(n)) : by.concat(me)).join(", ") }, true);
    }
    else if (act === "review") update("recipes", el.dataset.id, { reviewed: el.dataset.v === "1", reviewed_by: el.dataset.v === "1" ? who : "" }, true);
    else if (act === "ui-set") { ui[el.dataset.f] = el.dataset.v; if (el.dataset.f === "menuView") localStorage.setItem("an-menu-view", el.dataset.v); render(true); }
    else if (act === "goto-day" || act === "sheet-day") { ui.tab = "menu"; localStorage.setItem("an-tab", "menu"); ui.sheet = el.dataset.id; render(true); const x = document.getElementById("sheet-x"); if (x) x.focus(); }
    else if (act === "sheet-close") closeSheet();
    else if (act === "clear-mine") { ui.mSector = ui.mStatus = ""; render(true); }
    else if (act === "clear-rec") { ui.rBlock = ui.rIn = ui.rRev = ""; render(true); }
    else if (act === "clear-take") { ui.tWho = ui.tStatus = ""; render(true); }
    else if (act === "fsheet") { ui.fsheet = !!el.dataset.v; render(true); const x = document.getElementById("sheet-x"); if (x) x.focus(); else { const b = view.querySelector(".fbtn"); if (b) b.focus(); } }
    else if (act === "clear-filters") { ui.fWho = ui.fStatus = ui.fRev = ui.fSector = ui.fStore = ui.fWhen = ui.fType = ui.fNoQty = ""; render(true); }
    else if (act === "logout") { queue = queue.filter(j => j.table !== "private"); saveQueue(); client.auth.signOut().then(() => location.reload()); }
  });
  view.addEventListener("submit", e => {
    e.preventDefault();
    const f = e.target; f.dataset.sent = "1";
    const kind = f.dataset.form, v = n => f.querySelector(`[name="${n}"]`).value.trim();
    if (kind === "add-item") {
      let unit = v("unit"), qty = num(v("qty")); const cu = cupUnit(unit), old = findIng(v("name"));
      if (cu) {
        const d = old ? dens(old) : densByName(v("name"));
        if (d) { const n = qty || 1; qty = Math.round(n * cu * d); unit = old ? old.unit : isLiquid(v("name")) ? "ml" : "g"; toast(`${nf.format(n)} ${unit0(cu, n)} de ${v("name")}: ${qty} ${unit}.`); }
        else unit = cu === 1 ? "xícara" : "colher de sopa";
      }
      const sameU = (a, b) => { const k = x => norm(x).replace(/^(unidade|unidades|und|unid)$/, "un").replace(/s$/, ""); return k(a) === k(b); };
      let ing;
      if (old && unit && !sameU(unit, old.unit || "un")) {
        // mesma comida em outra medida: não dá para somar g com unidade na lista de compras
        if (!S.recipe_items.some(i => i.ingredient_id === old.id)) { update("ingredients", old.id, { unit }); ing = old; }
        else { ing = ensureIngredient(`${old.name} (${unit})`, unit); toast(`${old.name} já está na lista em ${old.unit}. Criei "${ing.name}" para não misturar as medidas.`); }
      } else ing = ensureIngredient(v("name"), unit, f.querySelector('[name="sector"]') ? v("sector") : "");
      const row = { id: uid(), recipe_id: f.dataset.id, ingredient_id: ing.id, qty, suggested: false, veg: "", note: "", pos: nextPos("recipe_items") };
      if (hasCol("recipe_items", "kind") && f.querySelector('[name="kind"]')) row.kind = v("kind");
      add("recipe_items", row);
    } else if (kind === "new-recipe") {
      const r = { id: uid(), name: v("name"), block: v("block"), reviewed: false, reviewed_by: "", serves: "", weekly: false, notes: "", prep: "", pos: nextPos("recipes") };
      ui.open.delete("newrec"); ui.rec = r.id; add("recipes", r); window.scrollTo(0, 0);
      toast("Receita criada como ideia. Coloque num dia do cardápio para contar nas compras.");
      const n = document.getElementById("r-" + r.id); if (n) n.scrollIntoView({ block: "center" });
    } else if (kind === "add-pend") {
      if (f.dataset.item) { ui.open.delete("q-" + f.dataset.item); toast("Dúvida aberta. Ela aparece no fim da receita e em Pendências."); }
      const row = { id: uid(), kind: "Dúvida", subject: (f.dataset.about ? f.dataset.about + ": " : "") + v("subject"), detail: f.querySelector('[name="detail"]') ? v("detail") : "", answer: "", done: false, pos: nextPos("pendencias") };
      if (f.dataset.recipe) row.recipe_id = f.dataset.recipe;
      add("pendencias", row);
    } else if (kind === "add-private") {
      add("private", { id: uid(), item: v("item"), done: false, pos: nextPos("private") });
    } else if (kind === "add-extra") {
      add("extras", { id: uid(), grp: "Levar", item: v("item"), owner: "", done: false, buy: f.dataset.buy === "1", activity_id: f.dataset.activity || null, pos: nextPos("extras") });
    } else if (kind === "new-activity") {
      const a = { id: uid(), name: v("name"), notes: "", pos: nextPos("activities") };
      ui.open.add(a.id); add("activities", a);
    } else if (kind === "edit-pend") {
      ui.open.delete("ep-" + f.dataset.id); update("pendencias", f.dataset.id, { subject: v("subject"), detail: v("detail") }, true);
    } else if (kind === "edit-comment") {
      ui.open.delete("ec-" + f.dataset.id); update("comments", f.dataset.id, { body: v("body") }, true);
    } else if (kind === "add-comment") {
      ui.open.delete("cm-" + f.dataset.pend);
      add("comments", { id: uid(), pend_id: f.dataset.pend, author: who, body: v("body"), created_at: new Date().toISOString() });
    } else if (kind === "paste-recipe") {
      const lines = v("text").split("\n").map(parseLine).filter(Boolean);
      if (!lines.length) { delete f.dataset.sent; return toast("Não encontrei ingredientes no texto."); }
      const r = { id: uid(), name: v("name"), block: v("block"), reviewed: false, reviewed_by: "", serves: "", weekly: false, notes: "", prep: "", pos: nextPos("recipes") };
      S.recipes.push(r); persist("recipes", r);
      let novos = 0, pos = nextPos("recipe_items");
      for (const l of lines) {
        let ing = findIng(l.name), qty = l.qty;
        const cup = l.unit === "xícara" ? 1 : l.unit === "colher" ? 1 / 16 : 0;
        if (cup) { const d = dens(ing || { name: l.name, unit: "g" }); if (d) { qty = Math.round(l.qty * cup * d); l.unit = "g"; } }
        if (ing) { const a = l.unit.toLowerCase(), b = String(ing.unit).toLowerCase(); if ((a === "kg" && b === "g") || (a === "l" && b === "ml")) qty *= 1000; if ((a === "g" && b === "kg") || (a === "ml" && b === "l")) qty /= 1000; }
        else { novos++; ing = { id: uid(), name: l.name, unit: l.unit || "un", sector: guessSector(l.name), when_buy: "Antes da viagem", buy_hint: "", bought: false, from_home: false, owner: "", note: "" }; S.ingredients.push(ing); persist("ingredients", ing); }
        const it = { id: uid(), recipe_id: r.id, ingredient_id: ing.id, qty, suggested: false, veg: "", note: "", pos: pos++ };
        S.recipe_items.push(it); persist("recipe_items", it);
      }
      ui.open.delete("newrec"); ui.rec = r.id; render(true); window.scrollTo(0, 0);
      toast(`Receita criada com ${lines.length} ingredientes${novos ? `, ${novos} novos` : ""}. Confira as quantidades.`);
    } else if (kind === "add-person") {
      const name = v("name");
      if (S.people.some(p => norm(p.name) === norm(name))) { delete f.dataset.sent; return toast(`${name} já está na lista.`); }
      add("people", { id: uid(), name, pos: nextPos("people") });
    }
  });
  function go(t) {
    noDraft = true;
    if (t === "plano") t = localStorage.getItem("an-plano") || "menu";
    if (!TABS.includes(t)) t = "start";
    ui.tab = t; localStorage.setItem("an-tab", t); ui.back = null; ui.sheet = null; ui.fsheet = false; ui.rec = null; ui.open.delete("acct");
    [...ui.open].filter(k => /^(q-|ep-|ec-|lk-|bulk-|add-|new)/.test(k)).forEach(k => ui.open.delete(k));
    [...ui.open].filter(k => /^(cm-|x-|ed-|ai-)/.test(k)).forEach(k => ui.open.delete(k));
    if (SEC[t] === "plano") localStorage.setItem("an-plano", t);
    [...ui.open].filter(k => k.startsWith("own-")).forEach(k => ui.open.delete(k)); render(true); window.scrollTo(0, 0);
  }
  for (const id of ["#tabs", "#sub"]) $(id).addEventListener("click", e => { const b = e.target.closest("button"); if (b) go(b.dataset.tab); });

  /* ---------- início ---------- */
  async function start() {
    try { await loadAll(); } catch (err) { console.error(err); $("#app").hidden = false; view.innerHTML = `<p class="empty">Não foi possível carregar os dados. Recarregue a página; se continuar, confira se o projeto do Supabase está ativo.</p>`; return; }
    if (client && who && !needsSetup && !S.people.some(p => norm(p.name) === norm(who))) {
      const me = { id: uid(), name: who, pos: nextPos("people") }; S.people.push(me); persist("people", me);
    }
    if (!noTrash) S.trash.filter(t => Date.now() - new Date(t.deleted_at) > 7 * 864e5).forEach(t => { removeLocal("trash", t.id); persistDelete("trash", t.id); });
    if (client && S.ingredients[0] && "hint_qty" in S.ingredients[0]) { const tot = shopping(); S.ingredients.filter(i => i.buy_hint && i.hint_qty == null && tot.has(i.id)).forEach(i => { i.hint_qty = tot.get(i.id).qty; persistPatch("ingredients", i.id, { hint_qty: i.hint_qty }); }); }
    if (!sessionStorage.getItem("an-seen")) ui.tab = "start";
    sessionStorage.setItem("an-seen", "1");
    $("#login").hidden = true; $("#app").hidden = false; render(true); syncBadge();
    document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
    window.addEventListener("online", refresh);
    setInterval(() => { if (queue.length) flush(); }, 20000);
  }
  async function boot() {
    if (CFG.supabaseUrl && CFG.supabaseKey && window.supabase) {
      client = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey);
      const { data } = await client.auth.getSession();
      const setWho = u => { const n = ((u && u.email) || "").split("@")[0]; who = n ? n[0].toUpperCase() + n.slice(1) : ""; };
      if (data.session) { setWho(data.session.user); return start(); }
      $("#login").hidden = false; $("#who").focus();
      $("#pw-show").addEventListener("click", e => { const p = $("#pw"), show = p.type === "password"; p.type = show ? "text" : "password"; e.currentTarget.textContent = show ? "Ocultar" : "Mostrar"; e.currentTarget.setAttribute("aria-pressed", show); });
      $("#login-form").addEventListener("submit", async e => {
        e.preventDefault(); $("#login-err").textContent = "";
        const slug = $("#who").value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
        if (!slug) { $("#login-err").textContent = "Digite seu username."; return; }
        const btn = $("#login-form button[type=submit]"); btn.disabled = true; btn.textContent = "Entrando…";
        const { data: auth, error } = await client.auth.signInWithPassword({ email: `${slug}@${CFG.loginDomain}`, password: $("#pw").value });
        btn.disabled = false; btn.textContent = "Entrar";
        if (!error) setWho(auth.user);
        if (error) { $("#login-err").textContent = /invalid/i.test(error.message) ? "Username ou senha não conferem. Confira com o grupo e tente de novo." : "Não foi possível entrar. Confira a conexão e tente de novo."; return; }
        start();
      });
    } else start();
  }
  boot();
})();
