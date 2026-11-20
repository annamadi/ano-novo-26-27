/* Ano Novo 26/27: cardápio -> receitas -> ingredientes -> lista de compras.
   A lista de compras nunca é guardada: é sempre calculada a partir do cardápio. */
(() => {
  const CFG = window.APP_CONFIG || {};
  const TABLES = ["ingredients", "recipes", "recipe_items", "days", "menu", "pendencias", "extras"];
  const PREFIX = "an_";
  const LS_KEY = "ano-novo-2627";
  const BLOCKS = ["Jantar", "Café da manhã", "Snacks", "Sobremesa", "Bebidas", "Casa"];
  const WHEN = ["Black Friday (27/11)", "Antecipado, se congelar", "Semana da viagem (até 26/12)",
    "Fresco / repor lá", "A confirmar", "Alguém leva pronto", "Compra à parte"];

  const S = Object.fromEntries(TABLES.map(t => [t, []]));
  const ui = { tab: localStorage.getItem("an-tab") || "menu", open: new Set(), group: "when_buy", hideDone: false, q: "" };
  let client = null, renderPending = false;

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
    persistDelete(table, id); render(true);
  }

  async function loadAll() {
    if (client) {
      const res = await Promise.all(TABLES.map(t => client.from(PREFIX + t).select("*")));
      const bad = res.find(r => r.error);
      if (bad) throw bad.error;
      TABLES.forEach((t, i) => { S[t] = res[i].data; });
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
    view.innerHTML = ({ menu: vMenu, recipes: vRecipes, shop: vShop, pend: vPend, extras: vExtras }[ui.tab])() + datalists();
    window.scrollTo(0, y);
    const tot = shopping(); let done = 0;
    tot.forEach((_, id) => { const i = get("ingredients", id); if (i && (i.bought || i.from_home)) done++; });
    $("#status").innerHTML = `${done} de ${tot.size} itens de compra resolvidos` +
      (client ? ` <button class="link" data-act="logout">Sair</button>` : ` <span class="local">modo local: os dados ficam só neste navegador</span>`);
    if (ui.tab === "shop" && ui.q) filterShop();
  }
  const datalists = () => `<datalist id="dl-ings">${S.ingredients.map(i => `<option value="${esc(i.name)}">`).join("")}</datalist>
    <datalist id="dl-owners">${[...new Set([...S.ingredients.map(i => i.owner), ...S.extras.map(i => i.owner)].filter(Boolean))].map(o => `<option value="${esc(o)}">`).join("")}</datalist>
    <datalist id="dl-sectors">${[...new Set(S.ingredients.map(i => i.sector).filter(Boolean))].sort().map(o => `<option value="${esc(o)}">`).join("")}</datalist>`;

  const inp = (t, id, f, val, extra = "") => `<input data-act="set" data-t="${t}" data-id="${id}" data-f="${f}" value="${esc(val)}" ${extra}>`;
  const chk = (t, id, f, val, label) => `<label class="chk"><input type="checkbox" data-act="set" data-t="${t}" data-id="${id}" data-f="${f}" ${val ? "checked" : ""}><span>${label}</span></label>`;
  const area = (t, id, f, val, ph) => `<textarea data-act="set" data-t="${t}" data-id="${id}" data-f="${f}" rows="2" placeholder="${esc(ph)}">${esc(val)}</textarea>`;
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
            ${chk("days", d.id, "veg_guest", d.veg_guest, "Vegetariana presente")}
            ${chk("days", d.id, "breakfast", d.breakfast, "Café da manhã")}
          </div>
          ${d.veg_guest ? `<label class="fld vegopt">Opção vegetariana${area("days", d.id, "veg_option", d.veg_option, "O que a vegetariana come neste dia")}</label>` : ""}
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
    return `<form class="newrow" data-form="new-recipe">
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
          <div class="tags">${it.suggested ? `<span class="tag sug">sugestão, confirmar</span>` : ""}${it.veg === "nao" ? `<span class="tag nov">não é vegetariano</span>` : ""}${it.veg === "conferir" ? `<span class="tag sug">conferir rótulo (vegetariana)</span>` : ""}${it.note && !more ? `<span class="note">${esc(it.note)}</span>` : ""}</div>
          ${more ? `<div class="more">
            <label class="fld">Observação${inp("recipe_items", it.id, "note", it.note)}</label>
            <label class="fld">Vegetariana<select data-act="set" data-t="recipe_items" data-id="${it.id}" data-f="veg">
              <option value="" ${!it.veg ? "selected" : ""}>Pode comer</option><option value="nao" ${it.veg === "nao" ? "selected" : ""}>Não come</option><option value="conferir" ${it.veg === "conferir" ? "selected" : ""}>Conferir rótulo</option></select></label>
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
        <span class="rmeta ${st.idea ? "idea" : ""}">${esc(st.text)} / ${items.length} ${items.length === 1 ? "item" : "itens"}</span>
      </button>${body}</article>`;
  }

  function vShop() {
    const tot = shopping();
    const used = S.ingredients.filter(i => tot.has(i.id));
    const unused = S.ingredients.filter(i => !tot.has(i.id)).sort((a, b) => a.name.localeCompare(b.name, "pt"));
    const keyOf = i => ui.group === "owner" ? (i.owner || "Sem responsável") : (i[ui.group] || "Sem grupo");
    const groups = new Map();
    used.forEach(i => { const k = keyOf(i); (groups.get(k) || groups.set(k, []).get(k)).push(i); });
    const order = [...groups.keys()].sort((a, b) => ui.group === "when_buy" ? ((WHEN.indexOf(a) + 99) % 99) - ((WHEN.indexOf(b) + 99) % 99) : a.localeCompare(b, "pt"));
    return `<div class="shopbar">
      <input type="search" id="shop-q" placeholder="Buscar item" value="${esc(ui.q)}" aria-label="Buscar item">
      <label class="fld inline">Agrupar por <select data-act="ui" data-f="group">
        <option value="when_buy" ${ui.group === "when_buy" ? "selected" : ""}>Quando comprar</option>
        <option value="sector" ${ui.group === "sector" ? "selected" : ""}>Setor do mercado</option>
        <option value="owner" ${ui.group === "owner" ? "selected" : ""}>Responsável</option></select></label>
      <label class="chk"><input type="checkbox" data-act="ui" data-f="hideDone" ${ui.hideDone ? "checked" : ""}><span>Esconder resolvidos</span></label>
    </div>
    ${order.map(k => {
      const list = groups.get(k).filter(i => !(ui.hideDone && (i.bought || i.from_home))).sort((a, b) => a.name.localeCompare(b.name, "pt"));
      const all = groups.get(k), ok = all.filter(i => i.bought || i.from_home).length;
      return list.length ? `<h2>${esc(k)} <small>${ok}/${all.length}</small></h2><ul class="shop">${list.map(i => vItem(i, tot.get(i.id))).join("")}</ul>` : "";
    }).join("") || `<p class="empty">Nada para comprar: o cardápio está vazio.</p>`}
    ${unused.length ? `<details class="unused"><summary>Fora do cardápio (${unused.length})</summary>
      <p class="hint">Ingredientes que nenhuma receita ativa usa. As marcações ficam guardadas caso voltem.</p>
      <ul class="plain">${unused.map(i => `<li><span>${esc(i.name)}</span><button class="ghost" data-act="del" data-t="ingredients" data-id="${i.id}" data-confirm="Excluir ${esc(i.name)} de vez, inclusive das receitas guardadas?">Excluir</button></li>`).join("")}</ul></details>` : ""}`;
  }
  function vItem(i, e) {
    const open = ui.open.has(i.id), done = i.bought || i.from_home;
    return `<li class="item ${done ? "done" : ""}" data-name="${esc(norm(i.name))}">
      <input type="checkbox" class="big" data-act="set" data-t="ingredients" data-id="${i.id}" data-f="bought" ${i.bought ? "checked" : ""} aria-label="Comprado: ${esc(i.name)}">
      <button class="imain" data-act="open" data-key="${i.id}" aria-expanded="${open}">
        <span class="iname2">${esc(i.name)}</span><span class="iqty2">${esc(fmtQty(e.qty, i.unit))}</span>
        <span class="isub">${esc(i.buy_hint)}</span>
        <span class="chips">${i.from_home ? `<span class="tag home">vem de casa</span>` : ""}${i.owner ? `<span class="tag who">${esc(i.owner)}</span>` : ""}</span>
      </button>
      ${open ? `<div class="ibody">
        <div class="grid2">
          <label class="fld">Nome (muda em todas as receitas)${inp("ingredients", i.id, "name", i.name)}</label>
          <label class="fld">Unidade${inp("ingredients", i.id, "unit", i.unit)}</label>
          <label class="fld">Como comprar (embalagem)${inp("ingredients", i.id, "buy_hint", i.buy_hint)}</label>
          <label class="fld">Responsável${inp("ingredients", i.id, "owner", i.owner, 'list="dl-owners" placeholder="Quem compra ou leva"')}</label>
          <label class="fld">Quando comprar<select data-act="set" data-t="ingredients" data-id="${i.id}" data-f="when_buy">${[...new Set(WHEN.concat(i.when_buy || []))].map(w => `<option ${w === i.when_buy ? "selected" : ""}>${esc(w)}</option>`).join("")}</select></label>
          <label class="fld">Setor${inp("ingredients", i.id, "sector", i.sector, 'list="dl-sectors"')}</label>
        </div>
        ${chk("ingredients", i.id, "from_home", i.from_home, "Vem de casa (alguém leva, não precisa comprar)")}
        <label class="fld">Observação${area("ingredients", i.id, "note", i.note, "Marca, tipo, onde achar")}</label>
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

  function vExtras() {
    const groups = [...new Set(["Levar", "Gincanas", ...S.extras.map(e => e.grp)])];
    return groups.map(g => `<h2>${esc(g)}</h2><ul class="extras">${S.extras.filter(e => e.grp === g).sort(byPos).map(e => `<li class="${e.done ? "done" : ""}">
      <input type="checkbox" class="big" data-act="set" data-t="extras" data-id="${e.id}" data-f="done" ${e.done ? "checked" : ""} aria-label="Feito: ${esc(e.item)}">
      ${inp("extras", e.id, "item", e.item, 'aria-label="Item"')}
      ${inp("extras", e.id, "owner", e.owner, 'list="dl-owners" placeholder="Quem leva ou organiza" aria-label="Responsável"')}
      <button class="x" data-act="del" data-t="extras" data-id="${e.id}" aria-label="Excluir ${esc(e.item)}">×</button></li>`).join("")}</ul>
      <form class="newrow" data-form="add-extra" data-grp="${esc(g)}"><input name="item" placeholder="Adicionar em ${esc(g)}" required><button class="btn">Adicionar</button></form>`).join("");
  }

  function filterShop() {
    const k = norm(ui.q);
    view.querySelectorAll(".shop .item").forEach(li => { li.hidden = !!k && !li.dataset.name.includes(k); });
  }

  /* ---------- ações ---------- */
  const num = v => { const n = parseFloat(String(v).replace(/\./g, "").replace(",", ".")); return Number.isFinite(n) ? n : 0; };
  function ensureIngredient(name, unit) {
    const found = findIng(name); if (found) return found;
    const ing = { id: uid(), name: name.trim(), unit: (unit || "un").trim() || "un", sector: "Mercado", when_buy: "Semana da viagem (até 26/12)", buy_hint: "", bought: false, from_home: false, owner: "", note: "" };
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
      if ((t === "recipes" || t === "extras") && (f === "name" || f === "item") && !String(v).trim()) return render(true);
      update(t, id, patch, force);
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
    else if (act === "logout") { client.auth.signOut().then(() => location.reload()); }
  });
  view.addEventListener("submit", e => {
    e.preventDefault();
    const f = e.target, kind = f.dataset.form, v = n => f.elements[n].value.trim();
    if (kind === "add-item") {
      const ing = ensureIngredient(v("name"), v("unit"));
      add("recipe_items", { id: uid(), recipe_id: f.dataset.id, ingredient_id: ing.id, qty: num(v("qty")), suggested: false, veg: "", note: "", pos: nextPos("recipe_items") });
    } else if (kind === "new-recipe") {
      const r = { id: uid(), name: v("name"), block: v("block"), serves: "", weekly: false, notes: "", prep: "", pos: nextPos("recipes") };
      ui.open.add(r.id); add("recipes", r);
      toast("Receita criada como ideia. Coloque num dia do cardápio para contar nas compras.");
      const n = document.getElementById("r-" + r.id); if (n) n.scrollIntoView({ block: "center" });
    } else if (kind === "add-pend") {
      add("pendencias", { id: uid(), kind: "Dúvida", subject: v("subject"), detail: v("detail"), answer: "", done: false, pos: nextPos("pendencias") });
    } else if (kind === "add-extra") {
      add("extras", { id: uid(), grp: f.dataset.grp, item: v("item"), owner: "", done: false, pos: nextPos("extras") });
    }
  });
  $("#tabs").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    ui.tab = b.dataset.tab; localStorage.setItem("an-tab", ui.tab); render(true); window.scrollTo(0, 0);
  });

  /* ---------- início ---------- */
  async function start() {
    try { await loadAll(); } catch (err) { console.error(err); $("#app").hidden = false; view.innerHTML = `<p class="empty">Não foi possível carregar os dados. Recarregue a página; se continuar, confira se o projeto do Supabase está ativo.</p>`; return; }
    $("#login").hidden = true; $("#app").hidden = false; render(true);
  }
  async function boot() {
    if (CFG.supabaseUrl && CFG.supabaseKey && window.supabase) {
      client = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey);
      const { data } = await client.auth.getSession();
      if (data.session) return start();
      $("#login").hidden = false; $("#pw").focus();
      $("#login-form").addEventListener("submit", async e => {
        e.preventDefault(); $("#login-err").textContent = "";
        const { error } = await client.auth.signInWithPassword({ email: CFG.groupEmail, password: $("#pw").value });
        if (error) { $("#login-err").textContent = /invalid/i.test(error.message) ? "Senha incorreta. Confira com o grupo e tente de novo." : "Não foi possível entrar. Confira a conexão e tente de novo."; return; }
        start();
      });
    } else start();
  }
  boot();
})();
