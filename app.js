/* Ano Novo 26/27: cardápio -> receitas -> ingredientes -> lista de compras.
   A lista de compras nunca é guardada: é sempre calculada a partir do cardápio. */
(() => {
  const CFG = window.APP_CONFIG || {};
  let who = "";
  const TABLES = ["ingredients", "recipes", "recipe_items", "days", "menu", "pendencias", "extras", "people", "activities"];
  const OPTIONAL = new Set(["people", "activities"]);
  const TABS = ["menu", "recipes", "shop", "take", "fun", "pend", "mine"];
  const PREFIX = "an_";
  const LS_KEY = "ano-novo-2627";
  const BLOCKS = ["Jantar", "Café da manhã", "Snacks", "Sobremesa", "Bebidas", "Casa"];
  const WHEN = ["Black Friday (27/11)", "Antecipado, se congelar", "Semana da viagem (até 26/12)",
    "Fresco / repor lá", "A confirmar", "Alguém leva pronto", "Compra à parte"];

  const S = Object.fromEntries(TABLES.map(t => [t, []]));
  const ui = { tab: localStorage.getItem("an-tab") || "menu", open: new Set(), group: "when_buy", fWho: "", fStatus: "", fRev: "", tWho: "", tStatus: "", mStatus: "", mSector: "", q: "", me: "" };
  if (!TABS.includes(ui.tab)) ui.tab = "menu";
  let client = null, renderPending = false, needsSetup = false, revMap = new Map();

  const $ = s => document.querySelector(s);
  const view = $("#view");
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const uid = () => crypto.randomUUID();
  const nf = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
  const get = (t, id) => S[t].find(r => r.id === id);
  const byPos = (a, b) => (a.pos ?? 0) - (b.pos ?? 0);
  const nextPos = t => S[t].reduce((m, r) => Math.max(m, r.pos ?? 0), 0) + 1;

  function toast(msg) {
    const el = $("#toast"); el.textContent = msg; el.classList.add("on");
    clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove("on"), 3800);
  }

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
  function remove(table, id) {
    removeLocal(table, id);
    if (table === "recipes") { S.recipe_items = S.recipe_items.filter(r => r.recipe_id !== id); S.menu = S.menu.filter(r => r.recipe_id !== id); }
    if (table === "ingredients") S.recipe_items = S.recipe_items.filter(r => r.ingredient_id !== id);
    if (table === "activities") S.extras = S.extras.filter(r => r.activity_id !== id);
    persistDelete(table, id); render(true);
  }

  async function loadAll() {
    if (client) {
      const res = await Promise.all(TABLES.map(t => client.from(PREFIX + t).select("*")));
      res.forEach((r, i) => {
        const t = TABLES[i];
        if (!r.error) S[t] = r.data;
        else if (OPTIONAL.has(t)) { needsSetup = true; S[t] = []; }
        else throw r.error;
      });
      if ((S.recipes[0] && !("reviewed" in S.recipes[0])) || (S.ingredients[0] && !("paid" in S.ingredients[0]))) needsSetup = true;
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
  function recipeCount(r) { return (r.weekly ? 1 : 0) + S.menu.filter(m => m.recipe_id === r.id).length; }
  function dayLabel(d, long) {
    const [y, m, dd] = d.date.split("-").map(Number);
    const wk = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"][new Date(y, m - 1, dd).getDay()];
    return long ? { wk, dd, mon: ["", "jan", "", "", "", "", "", "", "", "", "", "", "dez"][m] || m } : `${wk} ${String(dd).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
  }
  function recipeStatus(r) {
    const ds = S.menu.filter(m => m.recipe_id === r.id).map(m => get("days", m.day_id)).filter(Boolean)
      .sort((a, b) => a.date.localeCompare(b.date)).map(d => dayLabel(d));
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
    document.querySelectorAll("#tabs button").forEach(b => b.setAttribute("aria-current", b.dataset.tab === ui.tab ? "page" : "false"));
    const y = window.scrollY;
    revMap = unreviewed();
    view.innerHTML = (needsSetup ? `<p class="warn">Parte das novidades só salva depois que o banco for atualizado (arquivo supabase/migration-03.sql).</p>` : "") +
      ({ menu: vMenu, recipes: vRecipes, shop: vShop, take: vTake, fun: vFun, pend: vPend, mine: vMine }[ui.tab])() + datalists();
    window.scrollTo(0, y);
    const be = buyEntries(shopping());
    $("#status").innerHTML = `${be.filter(isDone).length} de ${be.length} itens comprados` +
      (client ? ` <span class="who">${esc(who)}</span> <button class="link" data-act="logout">Sair</button>` : ` <span class="local">modo local: os dados ficam só neste navegador</span>`);
    if (ui.tab === "shop" && ui.q) filterShop();
  }
  const datalists = () => `<datalist id="dl-ings">${S.ingredients.map(i => `<option value="${esc(i.name)}">`).join("")}</datalist>
    <datalist id="dl-stores">${[...new Set(S.ingredients.map(i => i.store).filter(Boolean))].sort().map(o => `<option value="${esc(o)}">`).join("")}</datalist>
    <datalist id="dl-sectors">${[...new Set(S.ingredients.map(i => i.sector).filter(Boolean))].sort().map(o => `<option value="${esc(o)}">`).join("")}</datalist>`;

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
      ${names.length ? "" : `<p class="hint">Cadastre as pessoas do grupo na aba Minha lista.</p>`}
      <button type="button" class="ghost" data-act="open" data-key="own-${id}">Pronto</button></div>`;
  }
  const money = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const numIn = v => v ? nf.format(v).replace(/\./g, "") : "";
  function xRow(e, showAct) {
    const a = showAct && e.activity_id ? get("activities", e.activity_id) : null;
    return `<li class="xrow ${e.done ? "done" : ""}" data-name="${esc(norm(e.item))}">
      <input type="checkbox" class="big" data-act="set" data-t="extras" data-id="${e.id}" data-f="done" ${e.done ? "checked" : ""} aria-label="${e.buy ? "Comprado" : "Separado"}: ${esc(e.item)}">
      ${inp("extras", e.id, "item", e.item, 'aria-label="Item"')}
      <button class="x" data-act="del" data-t="extras" data-id="${e.id}" aria-label="Excluir ${esc(e.item)}">×</button>
      <div class="xmeta">${pickBtn(e.id, e.owner)}${chk("extras", e.id, "buy", e.buy, "Precisa comprar")}
        ${e.buy ? `<label class="paid">R$ <input data-act="set" data-t="extras" data-id="${e.id}" data-f="paid" data-num="1" value="${esc(numIn(e.paid))}" inputmode="decimal" placeholder="pago" aria-label="Valor pago"></label>` : ""}
        ${a ? `<span class="tag">${esc(a.name)}</span>` : ""}</div>
      ${pickPanel("extras", e.id, e.owner)}
    </li>`;
  }

  /* listas: tudo que é comprar vai para Compras, tudo que é levar vai para Levar */
  const GROUPS = { when_buy: "Quando comprar", sector: "Categoria", store: "Local de compra", owner: "Responsável" };
  const NONE = { when_buy: "Sem data definida", sector: "Sem categoria", store: "Sem local definido", owner: "Sem responsável" };
  const isDone = en => en.k === "i" ? !!en.r.bought : !!en.r.done;
  const nameOf = en => en.k === "i" ? en.r.name : en.r.item;
  const buyEntries = tot => [...S.ingredients.filter(i => tot.has(i.id) && !i.from_home).map(r => ({ k: "i", r })), ...S.extras.filter(e => e.buy).map(r => ({ k: "x", r }))];
  const takeEntries = tot => [...S.ingredients.filter(i => tot.has(i.id) && i.from_home).map(r => ({ k: "i", r })), ...S.extras.filter(e => !e.buy).map(r => ({ k: "x", r }))];
  function keyOf(en, g) {
    if (g === "origin") {
      if (en.k === "i") return "Comida que vem de casa";
      const a = en.r.activity_id && get("activities", en.r.activity_id);
      return a ? "Entretenimento: " + a.name : "Itens de uso geral";
    }
    if (g === "owner") return en.r.owner || NONE.owner;
    if (en.k === "i") return en.r[g] || NONE[g];
    if (g === "sector") return en.r.activity_id ? "Entretenimento" : "Uso geral";
    return NONE[g];
  }
  function passF(en, f) {
    const o = en.r.owner;
    if (f.who && !(f.who === "-" ? !o : isMine(o, f.who))) return false;
    if (f.status && (f.status === "done") !== isDone(en)) return false;
    if (f.rev && (en.k !== "i" || (f.rev === "ok") === revMap.has(en.r.id))) return false;
    if (f.sector && keyOf(en, "sector") !== f.sector) return false;
    return true;
  }
  function groupList(entries, g, tot, tag = "h2") {
    const groups = new Map();
    entries.forEach(en => { const k = keyOf(en, g); (groups.get(k) || groups.set(k, []).get(k)).push(en); });
    const order = [...groups.keys()].sort((a, b) => g === "when_buy" ? ((WHEN.indexOf(a) + 99) % 99) - ((WHEN.indexOf(b) + 99) % 99) : (a === NONE[g]) - (b === NONE[g]) || a.localeCompare(b, "pt"));
    return order.map(k => {
      const l = groups.get(k).sort((a, b) => nameOf(a).localeCompare(nameOf(b), "pt"));
      return `<${tag} class="grp">${esc(k)} <small>${l.filter(isDone).length}/${l.length}</small></${tag}><ul class="shop xlist">${l.map(en => en.k === "i" ? vItem(en.r, tot.get(en.r.id), g) : xRow(en.r, g !== "origin")).join("")}</ul>`;
    }).join("");
  }
  const sel = (f, opts) => `<select data-act="ui" data-f="${f}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${ui[f] === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
  const whoOpts = () => [["", "Todas"], ...peopleNames().map(n => [n, n]), ["-", "Sem responsável"]];
  const paidSum = entries => entries.reduce((t, en) => t + (Number(en.r.paid) || 0), 0);
  function recipeOptions(sel) {
    return BLOCKS.concat([...new Set(S.recipes.map(r => r.block))].filter(b => !BLOCKS.includes(b))).map(b => {
      const rs = S.recipes.filter(r => r.block === b).sort(byPos);
      return rs.length ? `<optgroup label="${esc(b)}">${rs.map(r => `<option value="${r.id}" ${r.id === sel ? "selected" : ""}>${esc(r.name)}</option>`).join("")}</optgroup>` : "";
    }).join("");
  }

  function vMenu() {
    const days = [...S.days].sort((a, b) => a.date.localeCompare(b.date));
    const weekly = S.recipes.filter(r => r.weekly).sort(byPos);
    const ideas = S.recipes.filter(r => recipeCount(r) === 0).sort(byPos);
    return `<p class="lead">Troque ou adicione pratos em cada dia. A lista de compras se refaz sozinha com o que estiver aqui.</p>
    <section class="days">${days.map(d => {
      const L = dayLabel(d, true);
      const entries = S.menu.filter(m => m.day_id === d.id).sort(byPos);
      return `<article class="day ${d.veg_guest ? "veg" : ""}">
        <div class="date"><b>${L.dd}</b><span>${L.wk}, ${L.mon}</span></div>
        <div class="day-body">
          ${entries.map(m => `<div class="entry">
            <select data-act="set" data-t="menu" data-id="${m.id}" data-f="recipe_id" aria-label="Prato do dia">${recipeOptions(m.recipe_id)}</select>
            <button class="ghost" data-act="open-recipe" data-id="${m.recipe_id}">Ver receita</button>
            <button class="x" data-act="del" data-t="menu" data-id="${m.id}" aria-label="Tirar do dia">×</button>
          </div>`).join("") || `<p class="empty">Nenhum prato neste dia.</p>`}
          <select class="adder" data-act="menu-add" data-day="${d.id}" aria-label="Adicionar prato ao dia"><option value="">Adicionar prato ou sobremesa…</option>${recipeOptions()}</select>
          <div class="meta">
            <label class="num">Pessoas ${inp("days", d.id, "people", d.people, 'type="number" min="0" inputmode="numeric"')}</label>
            ${chk("days", d.id, "veg_guest", d.veg_guest, "Precisa de opção vegetariana")}
            ${chk("days", d.id, "breakfast", d.breakfast, "Café da manhã")}
          </div>
          ${d.veg_guest ? `<label class="fld vegopt">Opção vegetariana${area("days", d.id, "veg_option", d.veg_option, "Qual é a alternativa vegetariana deste dia")}</label>` : ""}
          <label class="fld">Observações${area("days", d.id, "notes", d.notes, "Lembretes do dia")}</label>
        </div></article>`;
    }).join("")}</section>
    <h2>A semana toda</h2>
    <p class="hint">Contam uma vez nas compras, sem dia marcado.</p>
    <ul class="plain">${weekly.map(r => `<li>${chk("recipes", r.id, "weekly", true, esc(r.name))}<span class="tag">${esc(r.block)}</span><button class="ghost" data-act="open-recipe" data-id="${r.id}">Ver receita</button></li>`).join("")}</ul>
    <h2>Ideias fora do cardápio</h2>
    <p class="hint">Não entram nas compras até irem para um dia ou para a semana toda.</p>
    ${ideas.length ? `<ul class="plain">${ideas.map(r => `<li>${chk("recipes", r.id, "weekly", false, esc(r.name))}<span class="tag">${esc(r.block)}</span><button class="ghost" data-act="open-recipe" data-id="${r.id}">Ver receita</button></li>`).join("")}</ul>` : `<p class="empty">Nenhuma ideia guardada. Crie uma receita na aba Receitas para ela aparecer aqui.</p>`}`;
  }

  function vRecipes() {
    const blocks = BLOCKS.concat([...new Set(S.recipes.map(r => r.block))].filter(b => !BLOCKS.includes(b)));
    const active = S.recipes.filter(r => recipeCount(r));
    return `<p class="lead">${active.filter(r => r.reviewed).length} de ${active.length} receitas do cardápio revisadas. Enquanto uma receita não for revisada, os ingredientes dela ficam com aviso na lista de compras.</p>
    <form class="newrow" data-form="new-recipe">
      <input name="name" placeholder="Nome da receita nova" required>
      <select name="block" aria-label="Tipo">${BLOCKS.map(b => `<option>${b}</option>`).join("")}</select>
      <button class="btn primary">Criar receita</button></form>
    ${blocks.map(b => {
      const rs = S.recipes.filter(r => r.block === b).sort(byPos);
      return rs.length ? `<h2>${esc(b)}</h2>${rs.map(vRecipe).join("")}` : "";
    }).join("")}`;
  }
  function vRecipe(r) {
    const open = ui.open.has(r.id), st = recipeStatus(r);
    const items = S.recipe_items.filter(i => i.recipe_id === r.id).sort(byPos);
    let body = "";
    if (open) body = `<div class="rbody">
      <div class="review ${r.reviewed ? "ok" : ""}">${r.reviewed
        ? `<span>Revisada${r.reviewed_by ? " por " + esc(r.reviewed_by) : ""}. Ingredientes e quantidades confirmados.</span><button class="ghost" data-act="review" data-id="${r.id}" data-v="0">Desfazer</button>`
        : `<span>Confira ingredientes e quantidades antes de alguém comprar.</span><button class="btn primary" data-act="review" data-id="${r.id}" data-v="1">Marcar como revisada</button>`}</div>
      <div class="grid2">
        <label class="fld">Nome${inp("recipes", r.id, "name", r.name)}</label>
        <label class="fld">Tipo<select data-act="set" data-t="recipes" data-id="${r.id}" data-f="block">${[...new Set(BLOCKS.concat(r.block))].map(b => `<option ${b === r.block ? "selected" : ""}>${esc(b)}</option>`).join("")}</select></label>
        <label class="fld">Para quantas pessoas${inp("recipes", r.id, "serves", r.serves)}</label>
        <div class="fld">${chk("recipes", r.id, "weekly", r.weekly, "Conta a semana toda (sem dia marcado)")}</div>
      </div>
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
        <input name="name" placeholder="Ingrediente" list="dl-ings" required data-act="ing-hint">
        <input name="qty" placeholder="Qtd" inputmode="decimal">
        <input name="unit" placeholder="un, g, lata…">
        <button class="btn">Adicionar</button>
      </form>
      <p class="hint">Trocar o nome aqui troca o ingrediente só nesta receita. Para renomear em todas, use a aba Compras.</p>
      <label class="fld">Modo de preparo e notas<textarea data-act="set" data-t="recipes" data-id="${r.id}" data-f="prep" rows="${Math.min(12, Math.max(3, (r.prep || "").split("\n").length + 1))}" placeholder="Passos, dicas, quem faz">${esc(r.prep)}</textarea></label>
      <button class="btn danger" data-act="del" data-t="recipes" data-id="${r.id}" data-confirm="Excluir a receita ${esc(r.name)}?">Excluir receita</button>
    </div>`;
    return `<article class="recipe ${open ? "open" : ""}" id="r-${r.id}">
      <button class="rhead" data-act="open" data-key="${r.id}" aria-expanded="${open}">
        <span class="rname">${esc(r.name)}</span>
        <span class="rmeta ${st.idea ? "idea" : ""}">${esc(st.text)} / ${items.length} ${items.length === 1 ? "item" : "itens"}${st.idea ? "" : r.reviewed ? ` / <b class="rok">revisada</b>` : ` / <b class="rtodo">a revisar</b>`}</span>
      </button>${body}</article>`;
  }

  function vShop() {
    const tot = shopping(), all = buyEntries(tot);
    const unused = S.ingredients.filter(i => !tot.has(i.id)).sort((a, b) => a.name.localeCompare(b.name, "pt"));
    const shown = all.filter(en => passF(en, { who: ui.fWho, status: ui.fStatus, rev: ui.fRev }));
    const paid = paidSum(all);
    return `<div class="shopbar">
      <input type="search" id="shop-q" placeholder="Buscar item" value="${esc(ui.q)}" aria-label="Buscar item">
      <label class="fld">Agrupar por ${sel("group", Object.entries(GROUPS))}</label>
      <label class="fld">Pessoa ${sel("fWho", whoOpts())}</label>
      <label class="fld">Situação ${sel("fStatus", [["", "Tudo"], ["todo", "Falta comprar"], ["done", "Já comprado"]])}</label>
      <label class="fld">Revisão ${sel("fRev", [["", "Tudo"], ["ok", "Receitas revisadas"], ["todo", "Receita a revisar"]])}</label>
    </div>
    <p class="hint">${all.filter(isDone).length} de ${all.length} itens comprados${paid ? `, R$ ${money.format(paid)} pagos até agora` : ""}.
      ${ui.fWho || ui.fStatus || ui.fRev ? `Mostrando ${shown.length}. <button class="ghost" data-act="clear-filters">Limpar filtros</button>` : ""}</p>
    ${groupList(shown, ui.group, tot) || `<p class="empty">${all.length ? "Nenhum item com esses filtros." : "Nada para comprar: o cardápio está vazio."}</p>`}
    <form class="newrow" data-form="add-extra" data-buy="1"><input name="item" placeholder="Adicionar compra que não é comida" required><button class="btn">Adicionar</button></form>
    <p class="hint">O que vem de casa fica na aba Levar. Itens de Levar e Entretenimento marcados com "Precisa comprar" aparecem aqui.</p>
    ${unused.length ? `<details class="unused"><summary>Fora do cardápio (${unused.length})</summary>
      <p class="hint">Ingredientes que nenhuma receita ativa usa. As marcações ficam guardadas caso voltem.</p>
      <ul class="plain">${unused.map(i => `<li><span>${esc(i.name)}</span><button class="ghost" data-act="del" data-t="ingredients" data-id="${i.id}" data-confirm="Excluir ${esc(i.name)} de vez, inclusive das receitas guardadas?">Excluir</button></li>`).join("")}</ul></details>` : ""}`;
  }
  function vItem(i, e, g) {
    const open = ui.open.has(i.id), done = i.bought, pend = revMap.get(i.id);
    return `<li class="item ${done ? "done" : ""}" data-name="${esc(norm(i.name))}">
      <input type="checkbox" class="big" data-act="set" data-t="ingredients" data-id="${i.id}" data-f="bought" ${i.bought ? "checked" : ""} aria-label="${i.from_home ? "Separado" : "Comprado"}: ${esc(i.name)}">
      <button class="imain" data-act="open" data-key="${i.id}" aria-expanded="${open}">
        <span class="iname2">${esc(i.name)}</span><span class="iqty2">${esc(fmtQty(e.qty, i.unit))}</span>
        <span class="isub">${esc(i.buy_hint)}</span>
        <span class="chips">${pend ? `<span class="tag sug">receita a revisar</span>` : ""}${g !== "sector" && i.sector ? `<span class="tag">${esc(i.sector)}</span>` : ""}${g !== "when_buy" && i.when_buy && !i.from_home ? `<span class="tag when">${esc(i.when_buy)}</span>` : ""}${g !== "store" && i.store ? `<span class="tag">${esc(i.store)}</span>` : ""}${i.owner ? `<span class="tag who">${esc(i.owner)}</span>` : ""}</span>
      </button>
      ${open ? `<div class="ibody">
        <div class="grid2">
          <label class="fld">Nome (muda em todas as receitas)${inp("ingredients", i.id, "name", i.name)}</label>
          <label class="fld">Unidade${inp("ingredients", i.id, "unit", i.unit)}</label>
          <label class="fld">Como comprar (embalagem)${inp("ingredients", i.id, "buy_hint", i.buy_hint)}</label>
          <div class="fld">Responsável<div class="pickwrap">${pickBtn(i.id, i.owner)}</div>${pickPanel("ingredients", i.id, i.owner)}</div>
          <label class="fld">Quando comprar<select data-act="set" data-t="ingredients" data-id="${i.id}" data-f="when_buy">${[...new Set(WHEN.concat(i.when_buy || []))].map(w => `<option ${w === i.when_buy ? "selected" : ""}>${esc(w)}</option>`).join("")}</select></label>
          <label class="fld">Categoria${inp("ingredients", i.id, "sector", i.sector, 'list="dl-sectors"')}</label>
          <label class="fld">Valor pago (R$)<input data-act="set" data-t="ingredients" data-id="${i.id}" data-f="paid" data-num="1" value="${esc(numIn(i.paid))}" inputmode="decimal" placeholder="0,00"></label>
          <label class="fld">Local de compra${inp("ingredients", i.id, "store", i.store, 'list="dl-stores" placeholder="Mercado, atacado, feira…"')}</label>
        </div>
        ${chk("ingredients", i.id, "from_home", i.from_home, "Vem de casa (alguém leva, não precisa comprar; vai para a aba Levar)")}
        <label class="fld">Observação${area("ingredients", i.id, "note", i.note, "Marca, tipo, onde achar")}</label>
        ${pend ? `<p class="uses todo">Falta revisar: ${pend.map(esc).join(", ")}. Confirme a receita antes de comprar.</p>` : ""}
        <p class="uses">Usado em: ${e.uses.map(u => `${esc(u.name)} (${esc(fmtQty(u.qty, i.unit))}${u.times > 1 ? " × " + u.times : ""})`).join("; ")}</p>
      </div>` : (i.note ? `<p class="inote">${esc(i.note)}</p>` : "")}
    </li>`;
  }

  function vPend() {
    const kinds = [...new Set(S.pendencias.map(p => p.kind))];
    return `<form class="newrow" data-form="add-pend">
      <input name="subject" placeholder="Assunto" required><input name="detail" placeholder="Qual é a dúvida ou o lembrete?">
      <button class="btn primary">Adicionar pendência</button></form>
    ${kinds.map(k => {
      const list = S.pendencias.filter(p => p.kind === k).sort((a, b) => (a.done - b.done) || byPos(a, b));
      return `<h2>${esc(k)} <small>${list.filter(p => p.done).length}/${list.length}</small></h2><ul class="pend">${list.map(p => `<li class="${p.done ? "done" : ""}">
        <input type="checkbox" class="big" data-act="set" data-t="pendencias" data-id="${p.id}" data-f="done" ${p.done ? "checked" : ""} aria-label="Resolvido: ${esc(p.subject)}">
        <div><strong>${esc(p.subject)}</strong><p>${esc(p.detail)}</p>
          ${area("pendencias", p.id, "answer", p.answer, k === "Dúvida" ? "Resposta" : "Comentário")}
          <button class="ghost" data-act="del" data-t="pendencias" data-id="${p.id}" data-confirm="Excluir esta pendência?">Excluir</button></div></li>`).join("")}</ul>`;
    }).join("")}`;
  }

  function vTake() {
    const tot = shopping(), all = takeEntries(tot);
    const shown = all.filter(en => passF(en, { who: ui.tWho, status: ui.tStatus }));
    const orphan = all.filter(en => !en.r.owner && !isDone(en)).map(nameOf);
    return `<p class="lead">O que vem de casa: comida pronta, itens de uso geral e o que as atividades precisam. Marque quando estiver separado.</p>
    ${orphan.length ? `<div class="warn"><strong>${orphan.length} ${orphan.length === 1 ? "item sem responsável" : "itens sem responsável"}:</strong> ${esc(orphan.slice(0, 8).join(", "))}${orphan.length > 8 ? ` e mais ${orphan.length - 8}` : ""}.
      ${ui.tWho === "-" ? "" : `<button class="ghost" data-act="ui-set" data-f="tWho" data-v="-">Ver só esses</button>`}</div>` : ""}
    <div class="shopbar">
      <label class="fld">Pessoa ${sel("tWho", whoOpts())}</label>
      <label class="fld">Situação ${sel("tStatus", [["", "Tudo"], ["todo", "Falta separar"], ["done", "Já separado"]])}</label>
    </div>
    ${groupList(shown, "origin", tot) || `<p class="empty">${all.length ? "Nenhum item com esses filtros." : "Nada na lista ainda."}</p>`}
    <form class="newrow" data-form="add-extra"><input name="item" placeholder="Adicionar item de uso geral" required><button class="btn">Adicionar</button></form>
    <p class="hint">Marcar "Precisa comprar" manda o item para a aba Compras. Os itens de cada atividade são criados na aba Entretenimento.</p>`;
  }

  function vFun() {
    return `<p class="lead">Jogos, gincanas e programas. O que cada atividade precisa aparece também na aba Levar.</p>
    <form class="newrow" data-form="new-activity"><input name="name" placeholder="Nome da atividade nova" required><button class="btn primary">Criar atividade</button></form>
    ${[...S.activities].sort(byPos).map(a => {
      const open = ui.open.has(a.id), items = S.extras.filter(e => e.activity_id === a.id).sort(byPos);
      const meta = items.length ? `${items.filter(e => e.done).length} de ${items.length} ${items.length === 1 ? "item resolvido" : "itens resolvidos"}` : "sem itens";
      return `<article class="recipe ${open ? "open" : ""}">
        <button class="rhead" data-act="open" data-key="${a.id}" aria-expanded="${open}"><span class="rname">${esc(a.name)}</span><span class="rmeta">${meta}</span></button>
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
    const me = ui.me || names.find(n => norm(n) === norm(who)) || who || names[0] || "";
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
      <label class="fld">Situação ${sel("mStatus", [["", "Tudo"], ["todo", "Ainda não marcado"], ["done", "Já marcado"]])}</label>
      <label class="fld">Categoria de compra ${sel("mSector", [["", "Todas"], ...sectors.map(x => [x, x])])}</label>
    </div>
    <p class="hint">Tudo em que ${esc(me)} aparece como responsável, incluindo o que está marcado para todos.${paid ? ` Valor pago nestes itens: R$ ${money.format(paid)}.` : ""}</p>
    <h2 class="sec">Comprar ${cnt(buyAll)}</h2>
    ${groupList(buy, "sector", tot, "h3") || `<p class="empty">${buyAll.length ? "Nenhuma compra com esses filtros." : "Nenhuma compra. Defina os responsáveis na aba Compras."}</p>`}
    <h2 class="sec">Levar ${cnt(takeAll)}</h2>
    ${groupList(take, "origin", tot, "h3") || `<p class="empty">${takeAll.length ? "Nenhum item com esses filtros." : "Nenhum item para levar. Defina os responsáveis na aba Levar."}</p>`}
    ${people}`;
  }

  function filterShop() {
    const k = norm(ui.q);
    view.querySelectorAll(".shop > li[data-name]").forEach(li => { li.hidden = !!k && !li.dataset.name.includes(k); });
  }

  /* ---------- ações ---------- */
  const num = v => { const n = parseFloat(String(v).replace(/\./g, "").replace(",", ".")); return Number.isFinite(n) ? n : 0; };
  function ensureIngredient(name, unit) {
    const found = findIng(name); if (found) return found;
    const ing = { id: uid(), name: name.trim(), unit: (unit || "un").trim() || "un", store: "", paid: 0, sector: "Mercado", when_buy: "Semana da viagem (até 26/12)", buy_hint: "", bought: false, from_home: false, owner: "", note: "" };
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
    const el = e.target.closest("[data-act]"); if (!el || /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return;
    const act = el.dataset.act;
    if (act === "open") { const k = el.dataset.key; ui.open.has(k) ? ui.open.delete(k) : ui.open.add(k); render(true); }
    else if (act === "open-recipe") { ui.tab = "recipes"; ui.open.add(el.dataset.id); render(true); const n = document.getElementById("r-" + el.dataset.id); if (n) n.scrollIntoView({ block: "start" }); }
    else if (act === "del") { if (!el.dataset.confirm || confirm(el.dataset.confirm)) remove(el.dataset.t, el.dataset.id); }
    else if (act === "review") update("recipes", el.dataset.id, { reviewed: el.dataset.v === "1", reviewed_by: el.dataset.v === "1" ? who : "" }, true);
    else if (act === "ui-set") { ui[el.dataset.f] = el.dataset.v; render(true); }
    else if (act === "clear-filters") { ui.fWho = ui.fStatus = ui.fRev = ""; render(true); }
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
      add("pendencias", { id: uid(), kind: "Dúvida", subject: v("subject"), detail: v("detail"), answer: "", done: false, pos: nextPos("pendencias") });
    } else if (kind === "add-extra") {
      add("extras", { id: uid(), grp: "Levar", item: v("item"), owner: "", done: false, buy: f.dataset.buy === "1", paid: 0, activity_id: f.dataset.activity || null, pos: nextPos("extras") });
    } else if (kind === "new-activity") {
      const a = { id: uid(), name: v("name"), notes: "", pos: nextPos("activities") };
      ui.open.add(a.id); add("activities", a);
    } else if (kind === "add-person") {
      const name = v("name");
      if (S.people.some(p => norm(p.name) === norm(name))) return toast(`${name} já está na lista.`);
      add("people", { id: uid(), name, pos: nextPos("people") });
    }
  });
  $("#tabs").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    ui.tab = b.dataset.tab; localStorage.setItem("an-tab", ui.tab);
    [...ui.open].filter(k => k.startsWith("own-")).forEach(k => ui.open.delete(k)); render(true); window.scrollTo(0, 0);
  });

  /* ---------- início ---------- */
  async function start() {
    try { await loadAll(); } catch (err) { console.error(err); $("#app").hidden = false; view.innerHTML = `<p class="empty">Não foi possível carregar os dados. Recarregue a página; se continuar, confira se o projeto do Supabase está ativo.</p>`; return; }
    if (client && who && !needsSetup && !S.people.some(p => norm(p.name) === norm(who))) {
      const me = { id: uid(), name: who, pos: nextPos("people") }; S.people.push(me); persist("people", me);
    }
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
