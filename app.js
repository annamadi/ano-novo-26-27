/* Ano Novo 26/27: cardápio -> receitas -> ingredientes -> lista de compras.
   A lista de compras nunca é guardada: é sempre calculada a partir do cardápio. */
(() => {
  const CFG = window.APP_CONFIG || {};
  let who = "";
  const TABLES = ["ingredients", "recipes", "recipe_items", "days", "menu", "pendencias", "extras", "people", "activities", "trash"];
  const OPTIONAL = new Set(["people", "activities", "trash"]);
  const TABS = ["start", "menu", "recipes", "home", "fun", "shop", "take", "mine", "pend"];
  const SEC = { start: "inicio", menu: "plano", recipes: "plano", home: "plano", fun: "plano", shop: "compras", take: "levar", mine: "minha", pend: "pend" };
  const TITLE = { start: "Início", menu: "Cardápio", recipes: "Receitas", home: "Casa", fun: "Entretenimento", shop: "Compras", take: "Levar", mine: "Minha lista", pend: "Pendências" };
  const PREFIX = "an_";
  const LS_KEY = "ano-novo-2627";
  const BLOCKS = ["Jantar", "Café da manhã", "Snacks", "Sobremesa", "Bebidas", "Casa"];
  const FOOD = BLOCKS.filter(b => b !== "Casa");
  const WHEN = ["Black Friday (27/11)", "Antes da viagem", "Lá, durante a semana", "A definir"];
  // nomes antigos, para os dados que ainda não foram renomeados no banco
  const WHEN_OLD = { "Antecipado, se congelar": "Antes da viagem", "Semana da viagem (até 26/12)": "Antes da viagem", "Compra à parte": "Antes da viagem", "Fresco / repor lá": "Lá, durante a semana", "A confirmar": "A definir" };
  const SEC_OLD = { "Mercado": "Mercearia", "Açougue / Peixaria": "Açougue e peixaria", "Casa": "Casa e descartáveis", "Feira": "Hortifruti" };
  const whenOf = i => WHEN_OLD[i.when_buy] || i.when_buy || "";
  const secOf = i => SEC_OLD[i.sector] || i.sector || "";
  const isFreeze = i => !!i.can_freeze || i.when_buy === "Antecipado, se congelar";
  const SECTORS = ["Mercearia", "Hortifruti", "Frios e laticínios", "Açougue e peixaria", "Padaria", "Bebidas", "Congelados", "Casa e descartáveis"];

  const HOME = "Alguém leva pronto";
  const isHome = i => !!i.from_home || i.when_buy === HOME;
  const S = Object.fromEntries(TABLES.map(t => [t, []]));
  const ui = { tab: localStorage.getItem("an-tab") || "start", open: new Set(), group: "when_buy", fWho: "", fStatus: "", fRev: "", fSector: "", fStore: "", fWhen: "", fType: "", showF: false, tWho: "", tStatus: "", mStatus: "", mSector: "", q: "", me: "", menuView: localStorage.getItem("an-menu-view") || "list", v: new URLSearchParams(location.search).get("v") || localStorage.getItem("an-v") || "a" };
  localStorage.setItem("an-v", ui.v);
  if (!TABS.includes(ui.tab)) ui.tab = "start";
  let client = null, renderPending = false, needsSetup = false, noTrash = false, revMap = new Map();

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
  async function persist(table, row) {
    if (!client) return saveLocal();
    const { error } = await client.from(PREFIX + table).upsert(row);
    if (error) { console.error(error); toast("Não salvou. Confira a conexão e tente de novo."); }
  }
  async function persistDelete(table, id) {
    if (!client) return saveLocal();
    const { error } = await client.from(PREFIX + table).delete().eq("id", id);
    if (error) { console.error(error); toast("Não excluiu. Confira a conexão e tente de novo."); }
  }
  function update(table, id, patch, force) {
    const row = get(table, id); if (!row) return;
    Object.assign(row, patch); persist(table, row); render(force);
  }
  function add(table, row, force = true) { S[table].push(row); persist(table, row); render(force); return row; }
  function removeLocal(table, id) { const i = S[table].findIndex(r => r.id === id); if (i >= 0) S[table].splice(i, 1); }
  const KIND = { recipes: "Receita", ingredients: "Ingrediente", activities: "Atividade", extras: "Item", pendencias: "Pendência", recipe_items: "Ingrediente de receita" };
  function remove(table, id) {
    const row = get(table, id); if (!row) return;
    const pay = { [table]: [row] };
    if (table === "recipes") { pay.recipe_items = S.recipe_items.filter(r => r.recipe_id === id); pay.menu = S.menu.filter(r => r.recipe_id === id); pay.pendencias = S.pendencias.filter(r => r.recipe_id === id); }
    if (table === "ingredients") pay.recipe_items = S.recipe_items.filter(r => r.ingredient_id === id);
    if (table === "activities") pay.extras = S.extras.filter(r => r.activity_id === id);
    let label = row.name || row.item || row.subject || "";
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
    const ok = { recipe_items: r => get("recipes", r.recipe_id) && get("ingredients", r.ingredient_id), menu: r => get("recipes", r.recipe_id) && get("days", r.day_id) };
    let skipped = 0;
    for (const tb of ["ingredients", "recipes", "activities", "recipe_items", "menu", "extras", "pendencias"]) for (const r of (t.payload[tb] || [])) {
      if (ok[tb] && !ok[tb](r)) { skipped++; continue; }
      if (tb === "extras" && r.activity_id && !get("activities", r.activity_id)) r.activity_id = null;
      if (tb === "pendencias" && r.recipe_id && !get("recipes", r.recipe_id)) r.recipe_id = null;
      if (!get(tb, r.id)) S[tb].push(r);
      await persist(tb, r);
    }
    removeLocal("trash", id); persistDelete("trash", id); render(true);
    toast(skipped ? `${t.label} voltou, menos ${skipped} ligações com coisas que não existem mais.` : `${t.label} voltou.`);
  }

  async function loadAll() {
    if (client) {
      const res = await Promise.all(TABLES.map(t => client.from(PREFIX + t).select("*")));
      res.forEach((r, i) => {
        const t = TABLES[i];
        if (!r.error) S[t] = r.data;
        else if (OPTIONAL.has(t)) { needsSetup = true; S[t] = []; if (t === "trash") noTrash = true; }
        else throw r.error;
      });
      if ((S.recipes[0] && !("reviewed" in S.recipes[0])) || (S.ingredients[0] && !("paid" in S.ingredients[0])) || (S.extras[0] && !("store" in S.extras[0])) || (S.ingredients[0] && !("bought_by" in S.ingredients[0])) || (S.ingredients[0] && !("can_freeze" in S.ingredients[0]))) needsSetup = true;
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
    return ds.length ? { text: ds.join(", "), idea: false } : { text: "ideia, fora das compras", idea: true };
  }
  function shopping() {
    const counts = new Map(S.recipes.map(r => [r.id, recipeCount(r)]));
    const tot = new Map();
    for (const it of S.recipe_items) {
      const c = counts.get(it.recipe_id) || 0; if (!c) continue;
      const e = tot.get(it.ingredient_id) || { qty: 0, uses: [] };
      e.qty += (Number(it.qty) || 0) * c;
      const r = get("recipes", it.recipe_id);
      e.uses.push({ name: r.name, qty: it.qty, times: c });
      tot.set(it.ingredient_id, e);
    }
    return tot;
  }
  // ingrediente -> receitas do cardápio que usam ele e ainda não foram revisadas
  function unreviewed() {
    const m = new Map();
    for (const it of S.recipe_items) {
      const r = get("recipes", it.recipe_id);
      if (!r || r.reviewed || !recipeCount(r)) continue;
      const l = m.get(it.ingredient_id) || []; if (!l.includes(r.name)) l.push(r.name); m.set(it.ingredient_id, l);
    }
    return m;
  }
  function fmtQty(q, u) {
    if (!q) return "a definir";
    if (u === "g" && q >= 1000) return nf.format(q / 1000) + " kg";
    if (u === "ml" && q >= 1000) return nf.format(q / 1000) + " L";
    return nf.format(q) + " " + u;
  }
  function findIng(name) { const k = norm(name); return S.ingredients.find(i => norm(i.name) === k); }

  /* ---------- render ---------- */
  function render(force) {
    const a = document.activeElement;
    if (!force && a && view.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== "checkbox") { renderPending = true; return; }
    renderPending = false;
    const sec = SEC[ui.tab];
    $("#app").dataset.sec = sec;
    document.querySelectorAll("#tabs button").forEach(b => b.setAttribute("aria-current", b.dataset.sec === sec ? "page" : "false"));
    $("#sub").hidden = sec !== "plano";
    $("#top").hidden = ui.tab === "start";
    document.querySelectorAll("#sub button").forEach(b => b.setAttribute("aria-current", b.dataset.tab === ui.tab ? "page" : "false"));
    const y = window.scrollY;
    revMap = unreviewed();
    view.innerHTML = (needsSetup ? `<p class="warn">Parte das novidades só salva depois que o banco for atualizado (arquivo supabase/migration-05.sql).</p>` : "") +
      ({ start: vStart, menu: vMenu, recipes: vRecipes, home: vHome, shop: vShop, take: vTake, fun: vFun, pend: vPend, mine: vMine }[ui.tab])() + datalists();
    window.scrollTo(0, y);
    view.querySelectorAll("input[placeholder]:not([aria-label])").forEach(i => { if (!i.closest("label")) i.setAttribute("aria-label", i.placeholder); });
    $("#top").innerHTML = ui.tab === "start" ? "" : header();
    if (ui.tab === "shop" && ui.q) filterShop();
  }
  const meName = () => { const names = peopleNames(); return ui.me || names.find(n => norm(n) === norm(who)) || who || names[0] || ""; };
  function headStat(tot) {
    const c = (l, f) => l.filter(f).length, t = ui.tab;
    if (t === "shop") { const l = buyEntries(tot), d = c(l, isDone); return { d, n: l.length, text: `${d} de ${l.length} itens comprados.` }; }
    if (t === "take") { const l = takeEntries(tot), d = c(l, isDone); return { d, n: l.length, text: `${d} de ${l.length} itens separados.` }; }
    if (t === "mine") { const me = meName(), l = [...buyEntries(tot), ...takeEntries(tot)].filter(en => isMine(en.r.owner, me)), d = c(l, isDone); return { d, n: l.length, text: me ? `${d} de ${l.length} itens de ${me} resolvidos.` : "Cadastre as pessoas do grupo." }; }
    if (t === "pend") { const d = c(S.pendencias, p => p.done); return { d, n: S.pendencias.length, text: `${d} de ${S.pendencias.length} pendências resolvidas.` }; }
    if (t === "recipes") { const l = S.recipes.filter(r => recipeCount(r) && r.block !== "Casa"), d = c(l, r => r.reviewed); return { d, n: l.length, text: `${d} de ${l.length} receitas do cardápio revisadas.` }; }
    if (t === "home") {
      const ids = new Set(S.recipes.filter(r => r.block === "Casa")), ings = new Set(S.recipe_items.filter(i => ids.has(get("recipes", i.recipe_id))).map(i => i.ingredient_id));
      const a = S.ingredients.filter(i => ings.has(i.id)), b = S.extras.filter(e => !e.activity_id), d = c(a, i => i.bought) + c(b, e => e.done), n = a.length + b.length;
      return { d, n, text: `${d} de ${n} itens da casa resolvidos.` };
    }
    if (t === "fun") { const l = S.extras.filter(e => e.activity_id), d = c(l, e => e.done); return { d, n: l.length, text: l.length ? `${d} de ${l.length} itens das atividades resolvidos.` : `${S.activities.length} atividades, nenhuma com itens ainda.` }; }
    const days = [...S.days].sort((a, b) => a.date.localeCompare(b.date)), d = c(days, x => S.menu.some(m => m.day_id === x.id));
    let left = "";
    if (days[0]) { const [y, m, dd] = days[0].date.split("-").map(Number), n = Math.ceil((new Date(y, m - 1, dd) - new Date().setHours(0, 0, 0, 0)) / 864e5); if (n > 0) left = n === 1 ? "Falta 1 dia. " : `Faltam ${n} dias. `; }
    return { d, n: days.length, text: `${left}${d} de ${days.length} dias com prato definido.` };
  }
  function header() {
    const st = headStat(shopping()), pct = st.n ? Math.round(100 * st.d / st.n) : 0;
    return `<div class="top-in">
      <div class="top-row"><span>Ano Novo 26/27</span>${client ? `<span class="acct">${esc(who)}<button class="link" data-act="logout">Sair</button></span>` : `<span>modo local, só neste navegador</span>`}</div>
      <h1>${TITLE[ui.tab]}</h1>
      <p class="status">${esc(st.text)}</p>
      <div class="meter" role="img" aria-label="${pct}% concluído"><i style="width:${pct}%"></i></div>
    </div>
    <svg class="wave" viewBox="0 0 1200 40" preserveAspectRatio="none" aria-hidden="true"><path d="M0 18 C 100 2, 200 34, 300 18 S 500 2, 600 18 S 800 34, 900 18 S 1100 2, 1200 18 V40 H0 Z"/></svg>`;
  }
  const tick = (t, id, f, val, label) => `<label class="tick"><input type="checkbox" data-act="set" data-t="${t}" data-id="${id}" data-f="${f}" ${val ? "checked" : ""} aria-label="${esc(label)}"><span></span></label>`;
  const datalists = () => `<datalist id="dl-ings">${S.ingredients.map(i => `<option value="${esc(i.name)}">`).join("")}</datalist>
    <datalist id="dl-stores">${[...new Set([...S.ingredients, ...S.extras].map(i => i.store).filter(Boolean))].sort().map(o => `<option value="${esc(o)}">`).join("")}</datalist>
    <datalist id="dl-sectors">${[...new Set(SECTORS.concat(S.ingredients.map(secOf).filter(Boolean)))].sort((a, b) => a.localeCompare(b, "pt")).map(o => `<option value="${esc(o)}">`).join("")}</datalist>`;

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
      <p class="hint">Falta alguém? Adicione em "Pessoas do grupo", no fim da aba Minha lista.</p>
      <button type="button" class="ghost" data-act="open" data-key="own-${id}">Pronto</button></div>`;
  }
  const money = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const numIn = v => v ? nf.format(v).replace(/\./g, "") : "";
  function xRow(e, showAct) {
    const a = showAct && e.activity_id ? get("activities", e.activity_id) : null;
    return `<li class="xrow ${e.done ? "done" : ""}" data-name="${esc(norm(e.item))}">
      ${tick("extras", e.id, "done", e.done, (e.buy ? "Comprado: " : "Separado: ") + e.item)}
      ${inp("extras", e.id, "item", e.item, 'aria-label="Item"')}
      <button class="x" data-act="del" data-t="extras" data-id="${e.id}" aria-label="Excluir ${esc(e.item)}">×</button>
      <div class="xmeta">${pickBtn(e.id, e.owner)}${chk("extras", e.id, "buy", e.buy, "Precisa comprar")}
        ${e.buy ? `<label class="paid">R$ <input data-act="set" data-t="extras" data-id="${e.id}" data-f="paid" data-num="1" value="${esc(numIn(e.paid))}" inputmode="decimal" placeholder="pago" aria-label="Valor pago"></label>
        ${hasCol("extras", "bought_by") ? `<select class="xstore" data-act="set" data-t="extras" data-id="${e.id}" data-f="bought_by" aria-label="Quem pagou">${payOpts(e.bought_by, "Quem pagou")}</select>` : ""}
        <input class="xstore" data-act="set" data-t="extras" data-id="${e.id}" data-f="store" value="${esc(e.store)}" list="dl-stores" placeholder="Loja" aria-label="Loja">` : ""}
        ${a ? `<span class="tag">${esc(a.name)}</span>` : ""}</div>
      ${pickPanel("extras", e.id, e.owner)}
    </li>`;
  }

  /* listas: tudo que é comprar vai para Compras, tudo que é levar vai para Levar */
  const GROUPS = { when_buy: "Momento", sector: "Seção", store: "Loja", owner: "Pessoa", type: "Comida ou item" };
  const NONE = { when_buy: "A definir", sector: "Sem seção", store: "Sem loja definida", owner: "Sem responsável" };
  const isDone = en => en.k === "i" ? !!en.r.bought : !!en.r.done;
  const nameOf = en => en.k === "i" ? en.r.name : en.r.item;
  const buyEntries = tot => [...S.ingredients.filter(i => tot.has(i.id) && !isHome(i)).map(r => ({ k: "i", r })), ...S.extras.filter(e => e.buy).map(r => ({ k: "x", r }))];
  const takeEntries = tot => [...S.ingredients.filter(i => tot.has(i.id) && isHome(i)).map(r => ({ k: "i", r })), ...S.extras.filter(e => !e.buy).map(r => ({ k: "x", r }))];
  function keyOf(en, g) {
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
  function groupList(entries, g, tot, tag = "h2", scope = "", defOpen = true) {
    const groups = new Map();
    entries.forEach(en => { const k = keyOf(en, g); (groups.get(k) || groups.set(k, []).get(k)).push(en); });
    const order = [...groups.keys()].sort((a, b) => g === "when_buy" ? ((WHEN.indexOf(a) + 99) % 99) - ((WHEN.indexOf(b) + 99) % 99) : (a === NONE[g]) - (b === NONE[g]) || a.localeCompare(b, "pt"));
    return order.map(k => {
      const l = groups.get(k).sort((a, b) => nameOf(a).localeCompare(nameOf(b), "pt")), d = l.filter(isDone).length;
      const key = `g-${scope}-${g}-${k}`, open = ui.open.has(key) !== defOpen;
      return `<section class="grp">
        <${tag} class="grp-h"><button class="chev" data-act="open" data-key="${esc(key)}" aria-expanded="${open}">
          <span class="grp-n">${esc(k)}</span><span class="grp-c">${d} de ${l.length}</span><span class="grp-m" aria-hidden="true"><i style="width:${Math.round(100 * d / l.length)}%"></i></span></button></${tag}>
        <ul class="shop xlist" data-closed="${open ? 0 : 1}" ${open ? "" : "hidden"}>${l.map(en => en.k === "i" ? vItem(en.r, tot.get(en.r.id), g) : xRow(en.r, g !== "origin")).join("")}</ul>
      </section>`;
    }).join("");
  }
  const sel = (f, opts) => `<select data-act="ui" data-f="${f}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${ui[f] === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
  const pill = (f, label, opts) => `<select class="pill ${ui[f] ? "on" : ""}" data-act="ui" data-f="${f}" aria-label="Filtrar por ${esc(label.toLowerCase())}"><option value="">${esc(label)}</option>${opts.map(([v, l]) => `<option value="${esc(v)}" ${ui[f] === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
  const seg3 = (f, labels) => `<div class="seg" role="group" aria-label="Situação">${[["", labels[0]], ["todo", labels[1]], ["done", labels[2]]].map(([v, l]) => `<button data-act="ui-set" data-f="${f}" data-v="${v}" aria-pressed="${ui[f] === v}">${l}</button>`).join("")}</div>`;
  const people2 = () => [...peopleNames().map(n => [n, n]), ["-", "Sem responsável"]];
  const whoOpts = () => [["", "Todas"], ...peopleNames().map(n => [n, n]), ["-", "Sem responsável"]];
  const payOpts = (cur, none = "Ninguém ainda") => [["", none], ...[...new Set(peopleNames().concat(cur || []))].map(n => [n, n])].map(([v, l]) => `<option value="${esc(v)}" ${v === (cur || "") ? "selected" : ""}>${esc(l)}</option>`).join("");
  const paidBy = entries => { const m = new Map(); entries.forEach(en => { const v = Number(en.r.paid) || 0; if (v) m.set(en.r.bought_by || "sem nome", (m.get(en.r.bought_by || "sem nome") || 0) + v); }); return [...m].map(([n, v]) => `${n} R$ ${money.format(v)}`).join("; "); };
  const paidSum = entries => entries.reduce((t, en) => t + (Number(en.r.paid) || 0), 0);
  const foodBlocks = () => FOOD.concat([...new Set(S.recipes.map(r => r.block))].filter(b => !BLOCKS.includes(b)));
  const short = n => String(n).replace(/\s*\(.*\)$/, "");
  function byCat(rs) {
    const m = new Map();
    [...rs].sort((a, b) => BLOCKS.indexOf(a.block) - BLOCKS.indexOf(b.block)).forEach(r => (m.get(r.block) || m.set(r.block, []).get(r.block)).push(r));
    return [...m];
  }
  function recipeOptions(sel) {
    return foodBlocks().map(b => {
      const rs = S.recipes.filter(r => r.block === b).sort(byPos);
      return rs.length ? `<optgroup label="${esc(b)}">${rs.map(r => `<option value="${r.id}" ${r.id === sel ? "selected" : ""}>${esc(r.name)}</option>`).join("")}</optgroup>` : "";
    }).join("");
  }

  function vMenu() {
    const days = [...S.days].sort((a, b) => a.date.localeCompare(b.date));
    const weekly = S.recipes.filter(r => r.weekly && r.block !== "Casa").sort(byPos);
    const dinnerIdeas = S.recipes.filter(r => r.block === "Jantar" && recipeCount(r) === 0).sort(byPos);
    const row = (r, on) => `<li><button class="rowlink" data-act="open-recipe" data-id="${r.id}">${esc(r.name)}</button>${r.reviewed ? `<span class="tag ok">revisada</span>` : ""}<button class="ghost" data-act="weekly" data-id="${r.id}" data-v="${on ? 0 : 1}">${on ? "Tirar" : "Pôr na semana"}</button></li>`;
    const byBlock = (list, on) => foodBlocks().map(b => { const l = list.filter(r => r.block === b); return l.length ? `<h3 class="grp">${esc(b)} <small>${l.length}</small></h3><ul class="plain">${l.map(r => row(r, on)).join("")}</ul>` : ""; }).join("");
    const names = d => S.menu.filter(m => m.day_id === d.id).sort(byPos).map(m => get("recipes", m.recipe_id)).filter(Boolean);
    const cal = () => `<div class="calwrap"><div class="cal">
      ${["dom", "seg", "ter", "qua", "qui", "sex", "sáb"].map(w => `<div class="calhead">${w}</div>`).join("")}
      ${days.map(d => {
        const [y, m, dd] = d.date.split("-").map(Number), wd = new Date(y, m - 1, dd).getDay(), L = dayLabel(d, true), ds = names(d);
        return `<button class="calday ${d.veg_guest ? "veg" : ""}" style="grid-column:${wd + 1}" data-act="goto-day" data-id="${d.id}" aria-label="Abrir ${L.wk} ${L.dd}">
          <span class="calnum"><b>${L.dd}</b> ${L.mon}</span>
          ${byCat(ds).map(([b, l]) => l.map(r => `<span class="dish">${b === "Jantar" ? "" : `<small class="cat">${esc(b)}</small>`}${esc(short(r.name))}</span>`).join("")).join("") || `<span class="dish none">sem prato</span>`}
          <span class="calfoot">${d.people} pessoas${d.veg_guest ? `<br>opção vegetariana` : ""}</span>
        </button>`;
      }).join("")}</div></div>
      <p class="hint">Toque num dia para abrir e editar.</p>`;
    return `<p class="lead">Toque num dia para trocar o prato. A lista de compras se refaz sozinha com o que estiver aqui.</p>
    <div class="seg" role="group" aria-label="Visualização">
      <button data-act="ui-set" data-f="menuView" data-v="list" aria-pressed="${ui.menuView !== "cal"}">Lista</button>
      <button data-act="ui-set" data-f="menuView" data-v="cal" aria-pressed="${ui.menuView === "cal"}">Calendário</button>
    </div>
    ${ui.menuView === "cal" ? cal() : `<section class="days">${days.map(d => {
      const L = dayLabel(d, true), open = ui.open.has("d-" + d.id);
      const entries = S.menu.filter(m => m.day_id === d.id).sort(byPos), ds = names(d);
      return `<article class="day ${d.veg_guest ? "veg" : ""}" id="d-${d.id}">
        <button class="day-h chev" data-act="open" data-key="d-${d.id}" aria-expanded="${open}">
          <span class="date"><b>${L.dd}</b><span>${L.wk}</span></span>
          <span class="day-sum">${ds.length ? byCat(ds).map(([b, l]) => b === "Jantar" ? `<strong>${l.map(r => esc(r.name)).join(", ")}</strong>` : `<span class="extra"><small class="cat">${esc(b)}</small>${l.map(r => esc(r.name)).join(", ")}</span>`).join("") : `<strong class="none">Sem prato definido</strong>`}
            <small>${d.people} pessoas${d.veg_guest ? ", com opção vegetariana" : ""}${d.breakfast ? "" : ", sem café da manhã"}</small></span>
        </button>
        ${open ? `<div class="day-body">
          ${entries.map(m => `<small class="cat">${esc((get("recipes", m.recipe_id) || {}).block || "")}</small><div class="entry">
            <select data-act="set" data-t="menu" data-id="${m.id}" data-f="recipe_id" aria-label="Prato do dia">${recipeOptions(m.recipe_id)}</select>
            <button class="ghost" data-act="open-recipe" data-id="${m.recipe_id}">Ver receita</button>
            <button class="x" data-act="del" data-t="menu" data-id="${m.id}" aria-label="Tirar do dia">×</button>
          </div>`).join("") || `<p class="empty">Nenhum prato neste dia.</p>`}
          <select class="adder" data-act="menu-add" data-day="${d.id}" aria-label="Adicionar prato ao dia"><option value="">Adicionar prato ou sobremesa…</option>${recipeOptions()}</select>
          <div class="meta">
            <label class="num">Pessoas ${inp("days", d.id, "people", d.people, 'type="number" min="0" inputmode="numeric"')}</label>
            ${chk("days", d.id, "veg_guest", d.veg_guest, "Precisa de opção vegetariana")}
          </div>
          ${d.veg_guest ? `<label class="fld vegopt">Opção vegetariana${area("days", d.id, "veg_option", d.veg_option, "Qual é a alternativa vegetariana deste dia")}</label>` : ""}
          <label class="fld">Observações${area("days", d.id, "notes", d.notes, "Lembretes do dia")}</label>
        </div>` : ""}</article>`;
    }).join("")}</section>`}
    <h2>Café da manhã <small>${days.filter(d => d.breakfast).length} de ${days.length} dias</small></h2>
    <p class="hint">Marque os dias que vão ter café. Os itens do café contam uma vez, para a semana inteira.</p>
    <div class="daypick">${days.map(d => { const L = dayLabel(d, true); return `<button type="button" class="dchip" data-act="toggle-bf" data-d="${d.id}" aria-pressed="${!!d.breakfast}" aria-label="Café em ${L.wk} ${L.dd}"><b>${L.dd}</b><small>${L.wk}</small></button>`; }).join("")}</div>
    ${S.recipes.filter(r => r.block === CAFE).sort(byPos).map(r => `<button class="ghost" data-act="open-recipe" data-id="${r.id}">Ver itens do café da manhã</button>`).join("")}
    ${foodBlocks().filter(b => b !== "Jantar" && b !== CAFE).map((b, k) => {
      const rs = S.recipes.filter(r => r.block === b).sort(byPos); if (!rs.length) return "";
      return `<h2>${esc(b)} <small>${rs.filter(r => recipeCount(r)).length} de ${rs.length} no cardápio</small></h2>
      ${k ? "" : `<p class="hint">Ligue o que vai ter durante a semana. O que fica desligado continua guardado como ideia e não entra nas compras.</p>`}
      <ul class="plain">${rs.map(r => { const ds = S.menu.filter(m => m.recipe_id === r.id).map(m => get("days", m.day_id)).filter(Boolean).sort((x, y) => x.date.localeCompare(y.date)).map(d => dayLabel(d));
        const st = r.weekly ? (ds.length ? "semana toda e " + ds.join(", ") : "semana toda") : ds.length ? "só em " + ds.join(", ") : "não vai";
        return `<li class="${recipeCount(r) ? "" : "off"}"><button class="rowlink" data-act="open-recipe" data-id="${r.id}">${esc(r.name)}<small>${esc(st)}</small></button>${r.reviewed ? `<span class="tag ok">revisada</span>` : ""}
          <label class="sw"><input type="checkbox" data-act="weekly-sw" data-id="${r.id}" ${recipeCount(r) ? "checked" : ""} aria-label="${esc(r.name)}: está no cardápio"><span></span></label></li>`; }).join("")}</ul>`;
    }).join("")}
    ${dinnerIdeas.length ? `<h2>Sugestões</h2>
    <p class="hint">Jantares sem dia marcado. Ficam fora das compras; para usar, abra a receita e marque um dia.</p>
    <ul class="plain">${dinnerIdeas.map(r => `<li><button class="rowlink" data-act="open-recipe" data-id="${r.id}">${esc(r.name)}</button></li>`).join("")}</ul>` : ""}`;
  }

  function vRecipes() {
    const blocks = foodBlocks();
    const active = S.recipes.filter(r => recipeCount(r));
    return `<p class="lead">Enquanto uma receita não for revisada, os ingredientes dela ficam com aviso na lista de compras.</p>
    <form class="newrow" data-form="new-recipe">
      <input name="name" placeholder="Nome da receita nova" required>
      <select name="block" aria-label="Tipo">${FOOD.map(b => `<option>${b}</option>`).join("")}</select>
      <button class="btn primary">Criar receita</button></form>
    ${blocks.map(b => {
      const rs = S.recipes.filter(r => r.block === b).sort(byPos);
      return rs.length ? `<h2>${esc(b)}</h2>${rs.map(r => vRecipe(r)).join("")}` : "";
    }).join("")}`;
  }
  function vRecipe(r, flat) {
    const open = flat || ui.open.has(r.id), st = recipeStatus(r);
    const items = S.recipe_items.filter(i => i.recipe_id === r.id).sort(byPos);
    const qs = S.pendencias.filter(p => p.recipe_id === r.id).sort((a, b) => (a.done - b.done) || byPos(a, b)), qOpen = qs.filter(p => !p.done).length;
    let body = "";
    if (open) body = `<div class="rbody">
      ${!flat && ui.back === r.id ? `<button class="btn back" data-act="back">Voltar ao cardápio</button>` : ""}
      ${flat ? "" : `      <div class="grid2">
        <label class="fld">Nome${inp("recipes", r.id, "name", r.name)}</label>
        <label class="fld">Tipo<select data-act="set" data-t="recipes" data-id="${r.id}" data-f="block">${[...new Set(BLOCKS.concat(r.block))].map(b => `<option ${b === r.block ? "selected" : ""}>${esc(b)}</option>`).join("")}</select></label>
        <label class="fld">Para quantas pessoas${inp("recipes", r.id, "serves", r.serves)}</label>
      </div>
${r.block === CAFE ? `<p class="note">Entra nas compras enquanto houver algum dia com café marcado no Cardápio.</p>` : `      <div class="fld">Quando entra no cardápio
        <div class="daypick">${[...S.days].sort((a, b) => a.date.localeCompare(b.date)).map(d => { const L = dayLabel(d, true), on = S.menu.some(m => m.day_id === d.id && m.recipe_id === r.id);
          return `<button type="button" class="dchip" data-act="toggle-day" data-r="${r.id}" data-d="${d.id}" aria-pressed="${on}" aria-label="${L.wk} ${L.dd}"><b>${L.dd}</b><small>${L.wk}</small></button>`; }).join("")}
          <button type="button" class="dchip wide" data-act="weekly" data-id="${r.id}" data-v="${r.weekly ? 0 : 1}" aria-pressed="${!!r.weekly}">Semana toda</button></div>
        <span class="note">Sem nenhum dia marcado, a receita fica como ideia e não entra nas compras.</span>
        <button type="button" class="ghost" data-act="back">Ver no cardápio</button></div>`}`}
      <ul class="items">${items.map(it => {
        const g = get("ingredients", it.ingredient_id) || { name: "?", unit: "" };
        const more = ui.open.has(it.id);
        return `<li class="it">
          <input class="iname" data-act="repoint" data-id="${it.id}" value="${esc(g.name)}" list="dl-ings" aria-label="Ingrediente">
          <input class="iqty" data-act="set" data-t="recipe_items" data-id="${it.id}" data-f="qty" data-num="1" value="${esc(nf.format(it.qty || 0).replace(/\./g, ""))}" inputmode="decimal" aria-label="Quantidade">
          <span class="unit">${esc(g.unit)}</span>
          <button class="ghost" data-act="open" data-key="${it.id}" aria-expanded="${more}">${more ? "Menos" : "Mais"}</button>
          <button class="x" data-act="del" data-t="recipe_items" data-id="${it.id}" aria-label="Tirar ${esc(g.name)}">×</button>
          <div class="tags">${it.suggested && !r.reviewed ? `<span class="tag sug">sugestão, confirmar</span>` : ""}${it.veg === "nao" ? `<span class="tag nov">não é vegetariano</span>` : ""}${it.veg === "conferir" ? `<span class="tag sug">conferir rótulo (vegetariano)</span>` : ""}${it.note && !more ? `<span class="note">${esc(it.note)}</span>` : ""}</div>
          ${more ? `<div class="more">
            <label class="fld">Observação${inp("recipe_items", it.id, "note", it.note)}</label>
            <label class="fld">Vegetariano?<select data-act="set" data-t="recipe_items" data-id="${it.id}" data-f="veg">
              <option value="" ${!it.veg ? "selected" : ""}>Sim</option><option value="nao" ${it.veg === "nao" ? "selected" : ""}>Não</option><option value="conferir" ${it.veg === "conferir" ? "selected" : ""}>Conferir rótulo</option></select></label>
          </div>` : ""}
        </li>`;
      }).join("") || `<li class="empty">Sem ingredientes ainda.</li>`}</ul>
      <form class="additem" data-form="add-item" data-id="${r.id}">
        <input name="name" placeholder="${flat ? "Item" : "Ingrediente"}" list="dl-ings" required data-act="ing-hint">
        <input name="qty" placeholder="Qtd" inputmode="decimal">
        <input name="unit" placeholder="un, g, lata…">
        <button class="btn">Adicionar</button>
      </form>
      ${!hasCol("pendencias", "recipe_id") ? "" : `<h3>Dúvidas desta receita <small>${qs.filter(p => p.done).length}/${qs.length}</small></h3>
      ${qs.length ? `<ul class="pend">${qs.map(p => pendRow(p, true)).join("")}</ul>` : ""}
      <form class="newrow" data-form="add-pend" data-recipe="${r.id}"><input name="subject" placeholder="Nova dúvida sobre esta receita" required><button class="btn">Adicionar dúvida</button></form>`}
      <div class="review ${r.reviewed ? "ok" : ""}">${r.reviewed
        ? `<span>Revisada${r.reviewed_by ? " por " + esc(r.reviewed_by) : ""}. Ingredientes e quantidades confirmados.</span><button class="ghost" data-act="review" data-id="${r.id}" data-v="0">Desfazer</button>`
        : qOpen ? `<span>Resolva ${qOpen === 1 ? "a dúvida acima" : `as ${qOpen} dúvidas acima`} antes de marcar como revisada.</span>`
        : `<span>Conferiu ingredientes e quantidades? Só marque depois de ler a lista.</span><button class="btn primary" data-act="review" data-id="${r.id}" data-v="1">Marcar como revisada</button>`}</div>
      ${flat ? "" : `      <p class="hint">Trocar o nome aqui troca o ingrediente só nesta receita. Para renomear em todas, use a aba Compras.</p>
      <label class="fld">Modo de preparo e notas<textarea data-act="set" data-t="recipes" data-id="${r.id}" data-f="prep" rows="${Math.min(12, Math.max(3, (r.prep || "").split("\n").length + 1))}" placeholder="Passos, dicas, quem faz">${esc(r.prep)}</textarea></label>
      <button class="btn danger" data-act="del" data-t="recipes" data-id="${r.id}" data-confirm="Excluir a receita ${esc(r.name)}?">Excluir receita</button>`}
    </div>`;
    if (flat) return `<article class="recipe open flat" id="r-${r.id}">${body}</article>`;
    return `<article class="recipe ${open ? "open" : ""}" id="r-${r.id}">
      <button class="rhead chev" data-act="open" data-key="${r.id}" aria-expanded="${open}"><span>
        <span class="rname">${esc(r.name)}</span>
        <span class="rmeta ${st.idea ? "idea" : ""}">${esc(st.text)}, ${items.length} ${items.length === 1 ? "item" : "itens"}</span></span>
        ${qOpen ? `<span class="tag nov">${qOpen} ${qOpen === 1 ? "dúvida" : "dúvidas"}</span>` : ""}${st.idea ? "" : r.reviewed ? `<span class="tag ok">revisada</span>` : `<span class="tag sug">a revisar</span>`}
      </button>${body}</article>`;
  }

  function vShop() {
    const tot = shopping(), all = buyEntries(tot);
    const unused = S.ingredients.filter(i => !tot.has(i.id)).sort((a, b) => a.name.localeCompare(b.name, "pt"));
    const vals = g => [...new Set(all.map(en => keyOf(en, g)))].sort((x, y) => g === "when_buy" ? ((WHEN.indexOf(x) + 99) % 99) - ((WHEN.indexOf(y) + 99) % 99) : (x === NONE[g]) - (y === NONE[g]) || x.localeCompare(y, "pt"));
    const FK = { fSector: "sector", fStore: "store", fWhen: "when_buy", fType: "type" };
    for (const k in FK) if (ui[k] && !vals(FK[k]).includes(ui[k])) ui[k] = "";
    const shown = all.filter(en => passF(en, { who: ui.fWho, status: ui.fStatus, rev: ui.fRev, sector: ui.fSector, store: ui.fStore, when: ui.fWhen, type: ui.fType }));
    const active = ["fWho", "fRev", "fSector", "fStore", "fWhen", "fType"].filter(k => ui[k]).length;
    const pick = (k, all0) => sel(k, [["", all0], ...vals(FK[k]).map(x => [x, x])]);
    const paid = paidSum(all);
    return `<div class="shopbar">
      <input type="search" id="shop-q" placeholder="Buscar item" value="${esc(ui.q)}" aria-label="Buscar item">
      ${seg3("fStatus", ["Tudo", "Falta", "Comprado"])}
      <label class="fld grouper">Agrupar por ${sel("group", Object.entries(GROUPS))}</label>
    </div>
    <div class="fchips" role="group" aria-label="Filtros">
      ${pill("fWho", "Pessoa", people2())}
      ${pill("fSector", "Seção", vals("sector").map(x => [x, x]))}
      ${pill("fWhen", "Momento", vals("when_buy").map(x => [x, x]))}
      ${pill("fStore", "Loja", vals("store").map(x => [x, x]))}
      ${vals("type").length > 1 ? pill("fType", "Comida ou item", vals("type").map(x => [x, x])) : ""}
      ${pill("fRev", "Revisão", [["ok", "Receitas revisadas"], ["todo", "Receita a revisar"]])}
      ${active || ui.fStatus ? `<button class="ghost" data-act="clear-filters">Limpar</button>` : ""}
    </div>
    ${paid || active || ui.fStatus ? `<p class="hint">${paid ? `R$ ${money.format(paid)} pagos até agora (${esc(paidBy(all))}). ` : ""}${active || ui.fStatus ? `Mostrando ${shown.length} de ${all.length} itens.` : ""}</p>` : `<p class="hint">Toque num grupo para abrir a lista.</p>`}
    ${groupList(shown, ui.group, tot, "h2", active || ui.fStatus ? "shopf" : "shop", !!(active || ui.fStatus)) || `<p class="empty">${all.length ? "Nenhum item com esses filtros." : "Nada para comprar: o cardápio está vazio."}</p>`}
    <form class="newrow" data-form="add-extra" data-buy="1"><input name="item" placeholder="Adicionar compra que não é comida" required><button class="btn">Adicionar</button></form>
    <p class="hint">O que vem de casa fica na aba Levar. Itens de Levar e Entretenimento marcados com "Precisa comprar" aparecem aqui.</p>
    ${unused.length ? `<details class="unused"><summary>Fora do cardápio (${unused.length})</summary>
      <p class="hint">Ingredientes que nenhuma receita ativa usa. As marcações ficam guardadas caso voltem.</p>
      <ul class="plain">${unused.map(i => `<li><span>${esc(i.name)}</span><button class="ghost" data-act="del" data-t="ingredients" data-id="${i.id}" data-confirm="Excluir ${esc(i.name)} de vez, inclusive das receitas guardadas?">Excluir</button></li>`).join("")}</ul></details>` : ""}`;
  }
  function vItem(i, e, g) {
    const open = ui.open.has(i.id), done = i.bought, pend = revMap.get(i.id);
    const hintDup = (() => { const m = norm(i.buy_hint).replace(/^~\s*/, "").match(/^([\d.,]+)\s*([a-zç]*)$/); if (!m) return false; const f = norm(fmtQty(e.qty, i.unit)).match(/^([\d.,]+)\s*(.*)$/); return !!f && num(m[1]) === num(f[1]) && (!m[2] || m[2].slice(0, 3) === f[2].slice(0, 3)); })();
    const stale = !!i.buy_hint && i.hint_qty != null && Math.abs(Number(i.hint_qty) - e.qty) > 1e-6;
    return `<li class="item ${done ? "done" : ""}" data-name="${esc(norm(i.name))}">
      ${tick("ingredients", i.id, "bought", i.bought, (isHome(i) ? "Separado: " : "Comprado: ") + i.name)}
      <button class="imain" data-act="open" data-key="${i.id}" aria-expanded="${open}">
        <span class="iname2">${esc(i.name)}</span><span class="iqty2">${esc(fmtQty(e.qty, i.unit))}</span>
        <span class="isub">${stale || hintDup ? "" : esc(i.buy_hint)}</span>
        <span class="chips">${pend ? `<span class="tag sug">receita a revisar</span>` : ""}${g !== "sector" && secOf(i) ? `<span class="tag">${esc(secOf(i))}</span>` : ""}${g !== "when_buy" && whenOf(i) && !isHome(i) ? `<span class="tag">${esc(whenOf(i))}</span>` : ""}${isFreeze(i) && !isHome(i) ? `<span class="tag">congelar</span>` : ""}${g !== "store" && i.store ? `<span class="tag">${esc(i.store)}</span>` : ""}${i.owner ? `<span class="tag who">${esc(i.owner)}</span>` : ""}${i.bought && i.bought_by ? `<span class="tag ok">pago por ${esc(i.bought_by)}</span>` : ""}</span>
      </button>
      ${open ? `<div class="ibody">
        <div class="grid2">
          <label class="fld">Nome (muda em todas as receitas)${inp("ingredients", i.id, "name", i.name)}</label>
          <label class="fld">Unidade${inp("ingredients", i.id, "unit", i.unit)}</label>
          <label class="fld">Como comprar (embalagem)${inp("ingredients", i.id, "buy_hint", i.buy_hint)}${stale ? `<span class="stale">Escrito quando o total era ${esc(fmtQty(Number(i.hint_qty), i.unit))}. Atualize ou apague.</span>` : ""}</label>
          <div class="fld">Responsável<div class="pickwrap">${pickBtn(i.id, i.owner)}</div>${pickPanel("ingredients", i.id, i.owner)}</div>
          ${isHome(i) ? "" : `<label class="fld">Momento da compra<select data-act="set" data-t="ingredients" data-id="${i.id}" data-f="when_buy">${[...new Set(WHEN.concat(whenOf(i) || []))].map(w => `<option ${w === whenOf(i) ? "selected" : ""}>${esc(w)}</option>`).join("")}</select></label>`}
          <label class="fld">Seção do mercado${inp("ingredients", i.id, "sector", secOf(i), 'list="dl-sectors"')}</label>
          <label class="fld">Valor pago (R$)<input data-act="set" data-t="ingredients" data-id="${i.id}" data-f="paid" data-num="1" value="${esc(numIn(i.paid))}" inputmode="decimal" placeholder="0,00"></label>
          ${isHome(i) || !hasCol("ingredients", "bought_by") ? "" : `<label class="fld">Quem pagou<select data-act="set" data-t="ingredients" data-id="${i.id}" data-f="bought_by">${payOpts(i.bought_by)}</select></label>`}
          <label class="fld">Loja${inp("ingredients", i.id, "store", i.store, 'list="dl-stores" placeholder="Mercado, atacado, feira…"')}</label>
        </div>
        ${isHome(i) || !hasCol("ingredients", "can_freeze") ? "" : chk("ingredients", i.id, "can_freeze", isFreeze(i), "Dá para comprar antes e congelar")}
        ${chk("ingredients", i.id, "from_home", isHome(i), "Vem de casa (alguém leva, não precisa comprar; vai para a aba Levar)")}
        <label class="fld">Observação${area("ingredients", i.id, "note", i.note, "Marca, tipo, onde achar")}</label>
        ${pend ? `<p class="uses todo">Falta revisar: ${pend.map(esc).join(", ")}. Confirme a receita antes de comprar.</p>` : ""}
        <p class="uses">Usado em: ${e.uses.map(u => `${esc(u.name)} (${esc(fmtQty(u.qty, i.unit))}${u.times > 1 ? " × " + u.times : ""})`).join("; ")}</p>
      </div>` : (i.note ? `<p class="inote">${esc(i.note)}</p>` : "")}
    </li>`;
  }

  function pendRow(p, inRecipe) {
    const key = norm(String(p.subject).split(":")[0]);
    const sug = S.recipes.filter(r => key && (norm(r.name).includes(key) || key.includes(norm(r.name))));
    const others = S.recipes.filter(r => !sug.includes(r)).sort((a, b) => a.name.localeCompare(b.name, "pt"));
    const o = r => `<option value="${r.id}">${esc(r.name)}</option>`;
    return `<li class="${p.done ? "done" : ""}">
      ${tick("pendencias", p.id, "done", p.done, "Resolvido: " + p.subject)}
      <div><strong>${esc(p.subject)}</strong>${p.detail ? `<p>${esc(p.detail)}</p>` : ""}
        ${area("pendencias", p.id, "answer", p.answer, p.kind === "Dúvida" ? "Resposta" : "Comentário")}
        ${!hasCol("pendencias", "recipe_id") ? "" : inRecipe ? `<button class="ghost" data-act="pend-out" data-id="${p.id}">Tirar da receita</button>`
          : `<select class="mover" data-act="pend-move" data-id="${p.id}" aria-label="Mover ${esc(p.subject)} para uma receita"><option value="">Mover para uma receita…</option>${sug.length ? `<optgroup label="Sugestões">${sug.map(o).join("")}</optgroup>` : ""}<optgroup label="Todas">${others.map(o).join("")}</optgroup></select>`}
        <button class="ghost" data-act="del" data-t="pendencias" data-id="${p.id}">Excluir</button></div></li>`;
  }
  function vPend() {
    const free = S.pendencias.filter(p => !p.recipe_id), linked = S.pendencias.length - free.length;
    const kinds = [...new Set(free.map(p => p.kind))];
    return `<form class="newrow" data-form="add-pend">
      <input name="subject" placeholder="Assunto" required><input name="detail" placeholder="Qual é a dúvida ou o lembrete?">
      <button class="btn primary">Adicionar pendência</button></form>
    <p class="hint">${linked ? `${linked} ${linked === 1 ? "pendência está" : "pendências estão"} dentro das receitas. ` : ""}Se a dúvida é sobre uma receita, mova para ela: passa a aparecer só lá.</p>
    ${kinds.map(k => {
      const list = free.filter(p => p.kind === k).sort((a, b) => (a.done - b.done) || byPos(a, b));
      return `<h2>${esc(k)} <small>${list.filter(p => p.done).length}/${list.length}</small></h2><ul class="pend">${list.map(p => pendRow(p)).join("")}</ul>`;
    }).join("") || `<p class="empty">Nenhuma pendência geral.</p>`}`;
  }

  function vTake() {
    const tot = shopping(), all = takeEntries(tot);
    const shown = all.filter(en => passF(en, { who: ui.tWho, status: ui.tStatus }));
    const orphan = all.filter(en => !en.r.owner && !isDone(en)).map(nameOf);
    return `<p class="lead">O que vem de casa: comida pronta, itens de uso geral e o que as atividades precisam. Marque quando estiver separado.</p>
    ${orphan.length ? `<div class="warn"><strong>${orphan.length} ${orphan.length === 1 ? "item sem responsável" : "itens sem responsável"}:</strong> ${esc(orphan.slice(0, 8).join(", "))}${orphan.length > 8 ? ` e mais ${orphan.length - 8}` : ""}.
      ${ui.tWho === "-" ? "" : `<button class="ghost" data-act="ui-set" data-f="tWho" data-v="-">Ver só esses</button>`}</div>` : ""}
    <div class="shopbar">${seg3("tStatus", ["Tudo", "Falta", "Separado"])}</div>
    <div class="fchips" role="group" aria-label="Filtros">${pill("tWho", "Pessoa", people2())}${ui.tWho || ui.tStatus ? `<button class="ghost" data-act="clear-take">Limpar</button>` : ""}</div>
    ${groupList(shown, "origin", tot, "h2", "take") || `<p class="empty">${all.length ? "Nenhum item com esses filtros." : "Nada na lista ainda."}</p>`}
    <form class="newrow" data-form="add-extra"><input name="item" placeholder="Adicionar item de uso geral" required><button class="btn">Adicionar</button></form>
    <p class="hint">Marcar "Precisa comprar" manda o item para a aba Compras. Os itens de cada atividade são criados na aba Entretenimento, e os suprimentos da casa, na aba Casa.</p>`;
  }

  function vHome() {
    const lists = S.recipes.filter(r => r.block === "Casa").sort(byPos);
    const plain = S.extras.filter(e => !e.activity_id).sort(byPos);
    return `<p class="lead">O que não é comida nem entretenimento. O que precisa ser comprado aparece na aba Compras; o que vem de casa, na aba Levar.</p>
    <h2>Suprimentos da casa</h2>
    <p class="hint">Limpeza, descartáveis e afins, com quantidade. Entram na lista de compras como os ingredientes.</p>
    ${lists.map(r => vRecipe(r, true)).join("") || `<p class="empty">Nenhuma lista de suprimentos.</p>`}
    <h2>Itens de uso geral <small>${plain.filter(e => e.done).length}/${plain.length}</small></h2>
    <p class="hint">Toalha, travesseiro, repelente. Marque "Precisa comprar" no que não for vir de casa.</p>
    <ul class="xlist">${plain.map(e => xRow(e)).join("") || `<li class="empty">Nada na lista ainda.</li>`}</ul>
    <form class="newrow" data-form="add-extra"><input name="item" placeholder="Adicionar item de uso geral" required><button class="btn">Adicionar</button></form>`;
  }

  function vFun() {
    return `<p class="lead">Jogos, gincanas e programas. O que cada atividade precisa aparece também na aba Levar.</p>
    <form class="newrow" data-form="new-activity"><input name="name" placeholder="Nome da atividade nova" required><button class="btn primary">Criar atividade</button></form>
    ${[...S.activities].sort(byPos).map(a => {
      const open = ui.open.has(a.id), items = S.extras.filter(e => e.activity_id === a.id).sort(byPos);
      const meta = items.length ? `${items.filter(e => e.done).length} de ${items.length} ${items.length === 1 ? "item resolvido" : "itens resolvidos"}` : "sem itens";
      return `<article class="recipe ${open ? "open" : ""}">
        <button class="rhead chev" data-act="open" data-key="${a.id}" aria-expanded="${open}"><span><span class="rname">${esc(a.name)}</span><span class="rmeta">${meta}</span></span></button>
        ${open ? `<div class="rbody">
          <label class="fld">Nome${inp("activities", a.id, "name", a.name)}</label>
          <label class="fld">Como funciona${area("activities", a.id, "notes", a.notes, "Regras, quem organiza, quando")}</label>
          <h3>O que precisa</h3>
          <ul class="xlist">${items.map(e => xRow(e)).join("") || `<li class="empty">Nada ainda.</li>`}</ul>
          <form class="newrow" data-form="add-extra" data-activity="${a.id}"><input name="item" placeholder="Item para comprar ou levar" required><button class="btn">Adicionar</button></form>
          <button class="btn danger" data-act="del" data-t="activities" data-id="${a.id}" data-confirm="Excluir a atividade ${esc(a.name)} e os itens dela?">Excluir atividade</button>
        </div>` : ""}</article>`;
    }).join("") || `<p class="empty">Nenhuma atividade ainda. Crie a primeira acima.</p>`}`;
  }

  function vMine() {
    const names = peopleNames();
    const me = meName();
    const opts = names.some(n => norm(n) === norm(me)) || !me ? names : names.concat(me);
    const people = `<h2>Pessoas do grupo</h2>
      <p class="hint">São os nomes que aparecem nas opções de responsável.</p>
      <ul class="plain">${[...S.people].sort(byPos).map(p => `<li><span>${esc(p.name)}</span><button class="x" data-act="del" data-t="people" data-id="${p.id}" data-confirm="Tirar ${esc(p.name)} das opções de responsável?" aria-label="Tirar ${esc(p.name)}">×</button></li>`).join("")}</ul>
      <form class="newrow" data-form="add-person"><input name="name" placeholder="Nome da pessoa" required><button class="btn">Adicionar pessoa</button></form>`;
    if (!me) return `<p class="lead">Cadastre as pessoas do grupo para ver a lista de cada uma.</p>${people}`;
    const tot = shopping();
    const buyAll = buyEntries(tot).filter(en => isMine(en.r.owner, me)), takeAll = takeEntries(tot).filter(en => isMine(en.r.owner, me));
    const sectors = [...new Set(buyAll.map(en => keyOf(en, "sector")))].sort((a, b) => a.localeCompare(b, "pt"));
    if (ui.mSector && !sectors.includes(ui.mSector)) ui.mSector = "";
    const buy = buyAll.filter(en => passF(en, { status: ui.mStatus, sector: ui.mSector })), take = takeAll.filter(en => passF(en, { status: ui.mStatus }));
    const cnt = l => `<small>${l.filter(isDone).length}/${l.length}</small>`, paid = paidSum(buyAll);
    return `<div class="shopbar">
      <label class="fld">Lista de <select data-act="ui" data-f="me">${opts.map(n => `<option ${norm(n) === norm(me) ? "selected" : ""}>${esc(n)}</option>`).join("")}</select></label>
      ${seg3("mStatus", ["Tudo", "Falta", "Feito"])}
    </div>
    <div class="fchips" role="group" aria-label="Filtros">${pill("mSector", "Seção", sectors.map(x => [x, x]))}</div>
    </div>
    <p class="hint">Tudo em que ${esc(me)} aparece como responsável, incluindo o que está marcado para todos.${paid ? ` Valor pago nestes itens: R$ ${money.format(paid)}.` : ""}</p>
    <h2 class="sec">Comprar ${cnt(buyAll)}</h2>
    ${groupList(buy, "sector", tot, "h3", "mb") || `<p class="empty">${buyAll.length ? "Nenhuma compra com esses filtros." : "Nenhuma compra. Defina os responsáveis na aba Compras."}</p>`}
    <h2 class="sec">Levar ${cnt(takeAll)}</h2>
    ${groupList(take, "origin", tot, "h3", "mt") || `<p class="empty">${takeAll.length ? "Nenhum item com esses filtros." : "Nenhum item para levar. Defina os responsáveis na aba Levar."}</p>`}
    ${people}
    ${noTrash ? "" : `<h2>Lixeira <small>${S.trash.length}</small></h2>
    <p class="hint">O que foi excluído fica aqui por 7 dias e pode voltar.</p>
    ${S.trash.length ? `<ul class="plain">${[...S.trash].sort((a, b) => String(b.deleted_at).localeCompare(String(a.deleted_at))).map(t => `<li><span>${esc(t.label)} <small class="note">${KIND[t.tbl] || ""}${t.deleted_by ? ", excluído por " + esc(t.deleted_by) : ""}</small></span><button class="ghost" data-act="restore" data-id="${t.id}">Restaurar</button></li>`).join("")}</ul>` : `<p class="empty">Vazia.</p>`}`}`;
  }

  function vStart() {
    const tot = shopping(), buy = buyEntries(tot), take = takeEntries(tot), me = meName();
    const mine = [...buy, ...take].filter(en => isMine(en.r.owner, me));
    const days = [...S.days].sort((a, b) => a.date.localeCompare(b.date));
    let n = null;
    if (days[0]) { const [y, m, dd] = days[0].date.split("-").map(Number); n = Math.ceil((new Date(y, m - 1, dd) - new Date().setHours(0, 0, 0, 0)) / 864e5); }
    const next = WHEN.map(w => [w, buy.filter(en => keyOf(en, "when_buy") === w && !isDone(en)).length]).find(([, c]) => c);
    const act = S.recipes.filter(r => recipeCount(r) && r.block !== "Casa"), open = S.pendencias.filter(p => !p.done).length;
    const cnt = (l, f) => l.filter(f).length;
    const tile = (tab, sec, title, big, small, sub, cls = "") => `<button class="tile ${cls}" data-go="${tab}" data-sec="${sec}"><span class="tile-t">${title}</span><span class="tile-n">${big}<i>${small}</i></span><span class="tile-s">${sub}</span></button>`;
    const cols = ["#D7263D", "#FFC62B", "#0B7A8A", "#177A4E", "#6B4FD8", "#FFFFFF", "#FFC62B"];
    const waves = cols.map((c, k) => { const y = 10 + k * 12, a = k % 2 ? 7 : -7; return `<path d="M-20 ${y} C 60 ${y + a}, 140 ${y - a}, 220 ${y} S 380 ${y + a}, 460 ${y} S 620 ${y - a}, 700 ${y} S 860 ${y + a}, 940 ${y}" stroke="${c}"/>`; }).join("");
    return `<section class="hero">
      <div class="top-row"><span>Ano Novo 26/27</span>${client ? `<span class="acct">${esc(who)}<button class="link" data-act="logout">Sair</button></span>` : `<span>modo local</span>`}</div>
      ${n === null ? "" : n > 0 ? `<p class="count"><b>${n}</b><span>${n === 1 ? "dia para" : "dias para"}<br>a viagem</span></p>` : `<p class="count"><b>Já</b><span>estamos<br>na viagem</span></p>`}
      <svg class="waves7" viewBox="0 0 900 96" preserveAspectRatio="none" aria-hidden="true">${waves}</svg>
    </section>
    <h2 class="vh">Cardápio da semana</h2>
    <div class="strip">${days.map(d => { const L = dayLabel(d, true), ds = S.menu.filter(m => m.day_id === d.id).sort(byPos).map(m => get("recipes", m.recipe_id)).filter(Boolean);
      return `<button class="sday ${d.veg_guest ? "veg" : ""}" data-act="goto-day" data-id="${d.id}"><span class="sd-h"><b>${L.dd}</b><span>${L.wk}</span></span>${ds.length ? byCat(ds).map(([b, l]) => `${b === "Jantar" ? "" : `<small class="cat">${esc(b)}</small>`}<em>${esc(l.map(r => short(r.name)).join(", "))}</em>`).join("") : `<em>sem prato</em>`}</button>`; }).join("")}</div>
    ${next ? `<button class="nextbuy" data-go="shop"><span>Próxima leva de compras</span><strong>${esc(next[0])}</strong><em>${next[1]} ${next[1] === 1 ? "item por comprar" : "itens por comprar"}</em></button>` : ""}
    <div class="tiles">
      ${tile("shop", "compras", "Compras", cnt(buy, isDone), `/${buy.length}`, "itens comprados")}
      ${tile("take", "levar", "Levar", cnt(take, isDone), `/${take.length}`, "itens separados")}
      ${tile("mine", "minha", "Minha lista", cnt(mine, isDone), `/${mine.length}`, me ? `itens de ${esc(me)}` : "sem pessoa definida")}
      ${tile("pend", "pend", "Pendências", open, "", open === 1 ? "em aberto" : "em aberto")}
      ${tile("recipes", "plano", "Receitas revisadas", cnt(act, r => r.reviewed), `/${act.length}`, "confira antes de alguém comprar", "wide")}
    </div>
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

  /* ---------- ações ---------- */
  const num = v => { const n = parseFloat(String(v).replace(/\./g, "").replace(",", ".")); return Number.isFinite(n) ? n : 0; };
  function ensureIngredient(name, unit) {
    const found = findIng(name); if (found) return found;
    const ing = { id: uid(), name: name.trim(), unit: (unit || "un").trim() || "un", sector: "Mercearia", when_buy: "Antes da viagem", buy_hint: "", bought: false, from_home: false, owner: "", note: "" };
    S.ingredients.push(ing); persist("ingredients", ing);
    toast(`Ingrediente novo criado: ${ing.name}.`);
    return ing;
  }

  view.addEventListener("change", e => {
    const el = e.target, act = el.dataset.act; if (!act) return;
    const force = el.type === "checkbox" || el.tagName === "SELECT";
    if (act === "set") {
      const { t, id, f } = el.dataset;
      let v = el.type === "checkbox" ? el.checked : el.dataset.num ? num(el.value) : el.type === "number" ? (parseInt(el.value, 10) || 0) : el.value;
      const patch = { [f]: v };
      if (t === "recipe_items" && f === "qty") patch.suggested = false;
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
      if (t === "ingredients" && f === "from_home" && !v && (get(t, id) || {}).when_buy === HOME) patch.when_buy = "A confirmar";
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
    } else if (act === "pend-move") {
      const r = get("recipes", el.value); if (!r) return;
      toast(`A pendência foi para a receita ${r.name}.`); update("pendencias", el.dataset.id, { recipe_id: r.id }, true);
    } else if (act === "repoint") {
      const it = get("recipe_items", el.dataset.id), name = el.value.trim();
      if (!it || !name) return render(true);
      const cur = get("ingredients", it.ingredient_id);
      if (cur && norm(cur.name) === norm(name)) return;
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
    if (el.dataset.act === "ing-hint") {
      const u = el.form.elements.unit, g = findIng(el.value);
      u.value = g ? g.unit : u.disabled ? "" : u.value; u.disabled = !!g;
    }
  });
  view.addEventListener("focusout", () => setTimeout(() => { if (renderPending) render(false); }, 0));
  document.addEventListener("click", e => {
    const g = e.target.closest("[data-go]"); if (g) return go(g.dataset.go);
    const el = e.target.closest("[data-act]"); if (!el || /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return;
    const act = el.dataset.act;
    if (act === "open") { const k = el.dataset.key; ui.open.has(k) ? ui.open.delete(k) : ui.open.add(k); render(true); }
    else if (act === "back") { ui.back = null; go("menu"); }
    else if (act === "open-recipe") { ui.back = ui.tab === "menu" ? el.dataset.id : null; ui.tab = (get("recipes", el.dataset.id) || {}).block === "Casa" ? "home" : "recipes"; ui.open.add(el.dataset.id); render(true); const n = document.getElementById("r-" + el.dataset.id); if (n) n.scrollIntoView({ block: "start" }); }
    else if (act === "del") { if (!el.dataset.confirm || confirm(el.dataset.confirm)) remove(el.dataset.t, el.dataset.id); }
    else if (act === "restore") { $("#toast").classList.remove("on"); restore(el.dataset.id); }
    else if (act === "pend-out") update("pendencias", el.dataset.id, { recipe_id: null }, true);
    else if (act === "set-v") { ui.v = el.dataset.v; localStorage.setItem("an-v", ui.v); go(ui.v === "b" ? "start" : "menu"); }
    else if (act === "toggle-bf") { const d = get("days", el.dataset.d); if (d) update("days", d.id, { breakfast: !d.breakfast }, true); }
    else if (act === "toggle-day") {
      const m = S.menu.find(x => x.day_id === el.dataset.d && x.recipe_id === el.dataset.r);
      if (m) remove("menu", m.id); else add("menu", { id: uid(), day_id: el.dataset.d, recipe_id: el.dataset.r, pos: nextPos("menu") });
    }
    else if (act === "weekly") { const r = get("recipes", el.dataset.id), on = el.dataset.v === "1"; if (r) { toast(on ? `${r.name} entrou na semana toda.` : `${r.name} virou ideia e saiu das compras.`); update("recipes", r.id, { weekly: on }, true); } }
    else if (act === "review") update("recipes", el.dataset.id, { reviewed: el.dataset.v === "1", reviewed_by: el.dataset.v === "1" ? who : "" }, true);
    else if (act === "ui-set") { ui[el.dataset.f] = el.dataset.v; if (el.dataset.f === "menuView") localStorage.setItem("an-menu-view", el.dataset.v); render(true); }
    else if (act === "goto-day") { ui.tab = "menu"; localStorage.setItem("an-tab", "menu"); ui.open.add("d-" + el.dataset.id); ui.menuView = "list"; localStorage.setItem("an-menu-view", "list"); render(true); const n = document.getElementById("d-" + el.dataset.id); if (n) n.scrollIntoView({ block: "start" }); }
    else if (act === "clear-take") { ui.tWho = ui.tStatus = ""; render(true); }
    else if (act === "clear-filters") { ui.fWho = ui.fStatus = ui.fRev = ui.fSector = ui.fStore = ui.fWhen = ui.fType = ""; render(true); }
    else if (act === "logout") { client.auth.signOut().then(() => location.reload()); }
  });
  view.addEventListener("submit", e => {
    e.preventDefault();
    const f = e.target, kind = f.dataset.form, v = n => f.querySelector(`[name="${n}"]`).value.trim();
    if (kind === "add-item") {
      const ing = ensureIngredient(v("name"), v("unit"));
      add("recipe_items", { id: uid(), recipe_id: f.dataset.id, ingredient_id: ing.id, qty: num(v("qty")), suggested: false, veg: "", note: "", pos: nextPos("recipe_items") });
    } else if (kind === "new-recipe") {
      const r = { id: uid(), name: v("name"), block: v("block"), reviewed: false, reviewed_by: "", serves: "", weekly: false, notes: "", prep: "", pos: nextPos("recipes") };
      ui.open.add(r.id); add("recipes", r);
      toast("Receita criada como ideia. Coloque num dia do cardápio para contar nas compras.");
      const n = document.getElementById("r-" + r.id); if (n) n.scrollIntoView({ block: "center" });
    } else if (kind === "add-pend") {
      const row = { id: uid(), kind: "Dúvida", subject: v("subject"), detail: f.querySelector('[name="detail"]') ? v("detail") : "", answer: "", done: false, pos: nextPos("pendencias") };
      if (f.dataset.recipe) row.recipe_id = f.dataset.recipe;
      add("pendencias", row);
    } else if (kind === "add-extra") {
      add("extras", { id: uid(), grp: "Levar", item: v("item"), owner: "", done: false, buy: f.dataset.buy === "1", activity_id: f.dataset.activity || null, pos: nextPos("extras") });
    } else if (kind === "new-activity") {
      const a = { id: uid(), name: v("name"), notes: "", pos: nextPos("activities") };
      ui.open.add(a.id); add("activities", a);
    } else if (kind === "add-person") {
      const name = v("name");
      if (S.people.some(p => norm(p.name) === norm(name))) return toast(`${name} já está na lista.`);
      add("people", { id: uid(), name, pos: nextPos("people") });
    }
  });
  function go(t) {
    if (t === "plano") t = localStorage.getItem("an-plano") || "menu";
    if (!TABS.includes(t)) t = "start";
    ui.tab = t; localStorage.setItem("an-tab", t); ui.back = null;
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
    if (client && S.ingredients[0] && "hint_qty" in S.ingredients[0]) { const tot = shopping(); S.ingredients.filter(i => i.buy_hint && i.hint_qty == null && tot.has(i.id)).forEach(i => { i.hint_qty = tot.get(i.id).qty; persist("ingredients", i); }); }
    if (!sessionStorage.getItem("an-seen")) ui.tab = "start";
    sessionStorage.setItem("an-seen", "1");
    $("#login").hidden = true; $("#app").hidden = false; render(true);
  }
  async function boot() {
    if (CFG.supabaseUrl && CFG.supabaseKey && window.supabase) {
      client = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey);
      const { data } = await client.auth.getSession();
      const setWho = u => { const n = ((u && u.email) || "").split("@")[0]; who = n ? n[0].toUpperCase() + n.slice(1) : ""; };
      if (data.session) { setWho(data.session.user); return start(); }
      $("#login").hidden = false; $("#who").focus();
      $("#login-form").addEventListener("submit", async e => {
        e.preventDefault(); $("#login-err").textContent = "";
        const slug = $("#who").value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
        if (!slug) { $("#login-err").textContent = "Digite seu username."; return; }
        const { data: auth, error } = await client.auth.signInWithPassword({ email: `${slug}@${CFG.loginDomain}`, password: $("#pw").value });
        if (!error) setWho(auth.user);
        if (error) { $("#login-err").textContent = /invalid/i.test(error.message) ? "Username ou senha não conferem. Confira com o grupo e tente de novo." : "Não foi possível entrar. Confira a conexão e tente de novo."; return; }
        start();
      });
    } else start();
  }
  boot();
})();
