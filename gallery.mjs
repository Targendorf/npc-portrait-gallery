const ID = "npc-portrait-gallery";
const FACETS = { city: "Город", organization: "Организация", ancestry: "Раса" };
const CARD_SIZES = { small: "Мелкие", medium: "Средние", large: "Крупные" };
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

function element(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) node[key] = value;
  node.append(...children);
  return node;
}

function button(label, action, className = "") {
  const node = element("button", { type: "button", className }, label);
  node.addEventListener("click", action);
  return node;
}

function portrait(entry) {
  const fallback = "icons/svg/mystery-man.svg";
  const image = element("img", { src: entry.img || fallback, alt: "", loading: "lazy", draggable: false });
  image.addEventListener("error", () => { image.src = fallback; }, { once: true });
  return image;
}

function openPortrait(entry) {
  const image = new foundry.applications.apps.ImagePopout({
    src: entry.img || "icons/svg/mystery-man.svg",
    window: { title: entry.name }
  });
  image.render({ force: true });
}

const entries = () => Object.values(game.settings.get(ID, "entries"));
const normalize = value => value.normalize("NFKC").toLocaleLowerCase().replaceAll("ё", "е");
const facetKey = value => `value:${normalize(value)}`;

function facetValues(value) {
  const unique = new Map();
  for (const raw of Array.isArray(value) ? value : [value]) {
    if (typeof raw !== "string") continue;
    const label = raw.trim();
    if (label && !unique.has(facetKey(label))) unique.set(facetKey(label), label);
  }
  return [...unique.values()];
}

function facetOptions(all, key) {
  return facetValues(all.flatMap(entry => facetValues(entry[key]))).sort((a, b) => a.localeCompare(b));
}

function matchesFacet(entry, key, value) {
  const labels = facetValues(entry[key]);
  return value === "" || (labels.length ? labels.some(label => facetKey(label) === value) : value === facetKey(""));
}

function pinned() {
  return game.settings.get(ID, "pins")[game.world.id]?.[game.user.id] ?? {};
}

async function updatePins(update) {
  const { world, user } = game;
  const stored = foundry.utils.deepClone(game.settings.get(ID, "pins"));
  const pins = (stored[world.id] ??= {})[user.id] ??= {};
  update(pins);
  await game.settings.set(ID, "pins", stored);
}

function setPin(id, position) {
  return updatePins(pins => {
    if (position) pins[id] = position;
    else delete pins[id];
  });
}

function canOpenActor(id) {
  const actor = game.actors.get(id);
  return Boolean(actor && (game.user.isGM || actor.isOwner));
}

function openActor(id) {
  if (canOpenActor(id)) game.actors.get(id).sheet?.render(true);
}

function fitPin(pin, x, y) {
  pin.style.left = `${Math.max(0, Math.min(x, innerWidth - pin.offsetWidth))}px`;
  pin.style.top = `${Math.max(0, Math.min(y, innerHeight - pin.offsetHeight))}px`;
}

function pinHandle(pin, ids) {
  const handle = button("⠿", () => {}, "npc-pin-handle");
  handle.title = "Перетащить. Отпустите над другим пином для объединения";
  handle.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;
    const { left, top } = pin.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    handle.setPointerCapture(event.pointerId);
    handle.onpointermove = move => fitPin(pin, left + move.clientX - startX, top + move.clientY - startY);
    handle.onpointerup = up => {
      if (Math.hypot(up.clientX - startX, up.clientY - startY) < 4) return;
      const target = document.elementsFromPoint(up.clientX, up.clientY)
        .map(node => node.closest(".npc-gallery-pin")).find(node => node && node !== pin);
      const targetId = target?.dataset.pinId;
      const x = pin.offsetLeft;
      const y = pin.offsetTop;
      void updatePins(pins => {
        const destination = pins[targetId];
        const group = destination ? destination.group ?? foundry.utils.randomID() : pins[ids[0]]?.group;
        const groupName = destination?.groupName || pins[ids[0]]?.groupName;
        const collapsed = destination?.group ? destination.collapsed : pins[ids[0]]?.collapsed;
        for (const id of ids) {
          if (pins[id]) pins[id] = destination
            ? { x: destination.x, y: destination.y, group, groupName, collapsed }
            : { x, y, group, groupName, collapsed };
        }
        if (destination) {
          for (const position of Object.values(pins)) {
            if (position === destination || position.group === group) Object.assign(position, { group, groupName, collapsed });
          }
        }
      });
    };
    handle.onpointercancel = () => fitPin(pin, left, top);
    handle.onlostpointercapture = () => {
      handle.onpointermove = null;
      handle.onpointerup = null;
    };
  });
  return handle;
}

async function renameGroup(group, currentName) {
  const content = element("div", {}, element("label", {}, "Название группы",
    element("input", { name: "name", defaultValue: currentName, maxLength: 60 })));
  const name = await foundry.applications.api.DialogV2.prompt({
    window: { title: "Название группы пинов" }, content, rejectClose: false,
    ok: { label: "Сохранить", callback: (_event, submit) => new FormData(submit.form).get("name").trim() }
  });
  if (typeof name !== "string") return;
  await updateGroup(group, { groupName: name });
}

function updateGroup(group, changes) {
  return updatePins(pins => {
    for (const position of Object.values(pins)) {
      if (position.group === group) Object.assign(position, changes);
    }
  });
}

function renderPins() {
  if (!game.user) return;
  document.getElementById(`${ID}-pins`)?.remove();
  const layer = element("div", { id: `${ID}-pins` });
  document.body.append(layer);
  const cards = new Map(entries().map(entry => [entry.id, entry]));
  const pins = pinned();
  const groups = new Map();
  for (const [id, position] of Object.entries(pins)) {
    if (!cards.has(id)) continue;
    const key = position.group ? `group:${position.group}` : `pin:${id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(id);
  }
  for (const ids of groups.values()) {
    const { x, y } = pins[ids[0]];
    const pin = element("div", { className: "npc-gallery-pin" });
    pin.dataset.pinId = ids[0];
    const members = element("div", { className: "npc-pin-members" });
    const { group, groupName, collapsed = false } = pins[ids[0]];
    if (group) {
      const title = button(groupName || "Группа пинов",
        () => updateGroup(group, { collapsed: !collapsed }), "npc-pin-group-name");
      title.ariaExpanded = String(!collapsed);
      title.title = "Клик — свернуть или раскрыть. Правый клик — переименовать";
      title.addEventListener("contextmenu", event => {
        event.preventDefault();
        void renameGroup(group, groupName ?? "");
      });
      members.append(title);
    }
    for (const id of collapsed ? [] : ids) {
      const entry = cards.get(id);
      const name = canOpenActor(id)
        ? button(entry.name, () => openActor(id), "npc-pin-name")
        : element("span", { className: "npc-pin-name" }, entry.name);
      name.prepend(portrait(entry));
      const row = element("div", { className: "npc-pin-row" }, name);
      if (ids.length > 1) {
        const detach = button("↗", () => setPin(id, { x: pin.offsetLeft + pin.offsetWidth + 12, y: pin.offsetTop + 32 }));
        detach.title = "Вынести из группы";
        row.append(detach);
      }
      const remove = button("×", () => setPin(id, null));
      remove.title = "Снять пин";
      row.append(remove);
      members.append(row);
    }
    pin.append(pinHandle(pin, ids), members);
    layer.append(pin);
    fitPin(pin, x, y);
  }
}

function facetRow(key, label, listId, value = "") {
  const input = element("input", { name: key, defaultValue: value, ariaLabel: label,
    placeholder: "Выберите или впишите" });
  input.setAttribute("list", listId);
  const remove = element("button", { type: "button", title: `Убрать поле «${label}»` }, "−");
  remove.dataset.facetAction = "remove";
  return element("div", { className: "npc-facet-row" }, input, remove);
}

function facetEditor(key, label, value, all) {
  const listId = `${ID}-${key}-${foundry.utils.randomID()}`;
  const list = element("datalist", { id: listId }, ...facetOptions(all, key).map(option => new Option(option, option)));
  const add = element("button", { type: "button", title: `Добавить поле «${label}»` }, "+");
  add.dataset.facetAction = "add";
  const labels = facetValues(value);
  const rows = element("div", { className: "npc-facet-rows" },
    ...(labels.length ? labels : [""]).map(text => facetRow(key, label, listId, text)));
  const field = element("fieldset", { className: "npc-facet-editor" },
    element("legend", {}, label), list, rows, add);
  field.dataset.facetKey = key;
  field.dataset.listId = listId;
  return field;
}

function editFacetRows(event) {
  const action = event.target.closest("[data-facet-action]");
  if (!action) return;
  const field = action.closest(".npc-facet-editor");
  const { facetKey: key, listId } = field.dataset;
  if (action.dataset.facetAction === "remove") {
    action.closest(".npc-facet-row").remove();
    field.querySelector('[data-facet-action="add"]').focus();
    return;
  }
  const row = facetRow(key, FACETS[key], listId);
  field.querySelector(".npc-facet-rows").append(row);
  row.querySelector("input").focus();
}

async function editEntry(actor, saved = {}) {
  const name = element("input", { name: "name", defaultValue: saved.name ?? actor.name, required: true });
  const all = entries();
  const fields = Object.entries(FACETS).map(([key, label]) => facetEditor(key, label, saved[key], all));
  const content = element("div", {}, element("div", { className: "npc-gallery-editor" },
    element("label", {}, "Имя и фамилия", name),
    ...fields));
  await foundry.applications.api.DialogV2.wait({
    window: { title: "Карточка NPC" }, content,
    render: (_event, dialog) => dialog.element.querySelector(".npc-gallery-editor").addEventListener("click", editFacetRows),
    buttons: [{ action: "save", label: "Опубликовать", default: true, callback: async (_event, submit) => {
      const data = new FormData(submit.form);
      const name = data.get("name").trim();
      if (!name) throw new Error("Введите имя NPC.");
      const current = game.settings.get(ID, "entries");
      const entry = { id: actor.id, name, img: actor.img };
      for (const key of Object.keys(FACETS)) entry[key] = facetValues(data.getAll(key));
      await game.settings.set(ID, "entries", { ...current, [actor.id]: entry });
    } }], rejectClose: false
  });
}

async function unpublish(entry) {
  const confirmed = await foundry.applications.api.DialogV2.confirm({
    window: { title: "Убрать карточку" }, content: "Убрать этого NPC из общего каталога?"
  });
  if (!confirmed) return;
  const current = { ...game.settings.get(ID, "entries") };
  delete current[entry.id];
  await game.settings.set(ID, "entries", current);
  if (pinned()[entry.id]) await setPin(entry.id, null);
}

function organizationHue(value) {
  let hash = 0;
  for (const character of normalize(value)) hash = (Math.imul(hash, 31) + character.codePointAt(0)) >>> 0;
  return hash % 360;
}

function card(entry, favorite) {
  const [organization] = facetValues(entry.organization);
  const details = Object.entries(FACETS).map(([key, label]) => {
    const allValues = facetValues(entry[key]).join(", ");
    const visible = key === "organization" ? organization : allValues;
    return element("span", { title: `${label}: ${allValues || "—"}` }, `${label}: ${visible || "—"}`);
  });
  const node = element("article", { className: "npc-gallery-card", tabIndex: 0,
    ariaLabel: entry.name }, portrait(entry), element("strong", { title: entry.name }, entry.name),
    element("small", { className: "npc-gallery-card-details" }, ...details));
  node.dataset.entryId = entry.id;
  if (organization) node.style.setProperty("--npc-card-outline", `hsl(${organizationHue(organization)} 60% 60%)`);
  if (favorite) node.append(element("span", {
    className: "npc-gallery-favorite", title: "В избранном", ariaLabel: "В избранном"
  }, "★"));
  node.addEventListener("keydown", event => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    const bounds = node.getBoundingClientRect();
    node.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true,
      clientX: bounds.left + bounds.width / 2, clientY: bounds.top + bounds.height / 2 }));
  });
  return node;
}

function bindCardMenu(grid, entriesById, refresh) {
  const entry = target => entriesById.get(target.dataset.entryId);
  const id = target => target.dataset.entryId;
  const toggleFavorite = async target => {
    const settings = game.settings.get(ID, "favorites");
    const favorites = new Set(settings.ids);
    if (!favorites.delete(id(target))) favorites.add(id(target));
    await game.settings.set(ID, "favorites", { ...settings, ids: [...favorites] });
    refresh();
  };
  new foundry.applications.ux.ContextMenu(grid, ".npc-gallery-card", [
    { name: "Открыть портрет", icon: '<i class="fa-solid fa-image"></i>', callback: target => openPortrait(entry(target)) },
    { name: "Открыть лист", icon: '<i class="fa-solid fa-file-lines"></i>',
      condition: target => canOpenActor(id(target)), callback: target => openActor(id(target)) },
    { name: "Добавить в избранное", icon: '<i class="fa-regular fa-star"></i>',
      condition: target => !game.settings.get(ID, "favorites").ids.includes(id(target)), callback: toggleFavorite },
    { name: "Убрать из избранного", icon: '<i class="fa-solid fa-star"></i>',
      condition: target => game.settings.get(ID, "favorites").ids.includes(id(target)), callback: toggleFavorite },
    { name: "Закрепить на экране", icon: '<i class="fa-solid fa-thumbtack"></i>',
      condition: target => !pinned()[id(target)], callback: target => {
        const offset = Object.keys(pinned()).length % 10;
        return setPin(id(target), { x: 110 + offset * 16, y: 90 + offset * 42 });
      } },
    { name: "Редактировать карточку", icon: '<i class="fa-solid fa-pen"></i>',
      condition: target => game.user.isGM && Boolean(game.actors.get(id(target))),
      callback: target => editEntry(game.actors.get(id(target)), entry(target)) },
    { name: "Убрать из галереи", icon: '<i class="fa-solid fa-trash"></i>',
      condition: () => game.user.isGM, callback: target => unpublish(entry(target)) }
  ], { fixed: true, jQuery: false });
}

class Gallery extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: ID, window: { title: "Галерея NPC", resizable: true },
    position: { width: 860, height: 640 }
  };

  static PARTS = { gallery: { template: `modules/${ID}/gallery.hbs` } };

  search = "";
  filters = {};

  _onRender(context, options) {
    super._onRender(context, options);
    const root = this.element.querySelector(".npc-gallery-content");
    const all = entries().sort((a, b) => a.name.localeCompare(b.name));
    const search = element("input", { type: "search", placeholder: "Поиск по имени…", ariaLabel: "Поиск по имени", value: this.search });
    const controls = element("div", { className: "npc-gallery-filters" }, search);
    const grid = element("div", { className: "npc-gallery-grid" });
    const status = element("p", { className: "npc-gallery-status", ariaLive: "polite" });
    const size = element("select", { ariaLabel: "Размер карточек" },
      ...Object.entries(CARD_SIZES).map(([value, label]) => new Option(label, value)));
    size.value = game.settings.get(ID, "cardSize");
    grid.dataset.size = size.value;
    size.addEventListener("change", async () => {
      await game.settings.set(ID, "cardSize", size.value);
      grid.dataset.size = size.value;
    });
    const first = element("input", { type: "checkbox", checked: game.settings.get(ID, "favorites").first });
    const toolbar = element("div", { className: "npc-gallery-toolbar" }, status,
      element("label", {}, first, "Сначала избранные"),
      element("label", {}, "Карточки", size));
    const refresh = () => {
      const favorites = new Set(game.settings.get(ID, "favorites").ids);
      const query = normalize(this.search.trim()).split(/\s+/);
      const shown = all.filter(entry => query.every(term => normalize(entry.name).includes(term)) &&
        Object.entries(this.filters).every(([key, value]) => matchesFacet(entry, key, value)));
      if (first.checked) shown.sort((a, b) => Number(favorites.has(b.id)) - Number(favorites.has(a.id)));
      grid.replaceChildren(...shown.map(entry => card(entry, favorites.has(entry.id))));
      status.textContent = shown.length ? `Найдено: ${shown.length}` : "Карточек нет";
    };
    bindCardMenu(grid, new Map(all.map(entry => [entry.id, entry])), refresh);
    first.addEventListener("change", async () => {
      await game.settings.set(ID, "favorites", { ...game.settings.get(ID, "favorites"), first: first.checked });
      refresh();
    });
    search.addEventListener("input", () => { this.search = search.value; refresh(); });
    for (const [key, label] of Object.entries(FACETS)) {
      const values = facetOptions(all, key);
      if (all.some(entry => !facetValues(entry[key]).length)) values.unshift("");
      const select = element("select", { ariaLabel: label }, new Option(label, ""),
        ...values.map(value => new Option(value || "Неизвестно", facetKey(value))));
      if (!values.some(value => facetKey(value) === this.filters[key])) delete this.filters[key];
      select.value = this.filters[key] ?? "";
      select.addEventListener("change", () => { this.filters[key] = select.value; refresh(); });
      controls.append(select);
    }
    root.replaceChildren(controls);
    if (game.user.isGM) {
      const actors = [...game.actors].sort((a, b) => a.name.localeCompare(b.name));
      const picker = element("select", { ariaLabel: "Персонаж из мира" }, new Option("Выбрать персонажа…", ""),
        ...actors.map(actor => new Option(actor.name, actor.id)));
      root.append(element("div", { className: "npc-gallery-manage" }, picker, button("Добавить NPC", () => {
        const actor = game.actors.get(picker.value);
        if (!actor) return ui.notifications.warn("Сначала выберите персонажа.");
        return editEntry(actor, game.settings.get(ID, "entries")[actor.id]);
      })));
    }
    root.append(toolbar, grid);
    refresh();
  }
}

let gallery;

Hooks.once("init", () => {
  game.settings.register(ID, "entries", { scope: "world", config: false, type: Object, default: {}, onChange: () => {
    if (gallery?.rendered) gallery.render();
    renderPins();
  } });
  game.settings.register(ID, "pins", { scope: "client", config: false, type: Object, default: {}, onChange: renderPins });
  game.settings.register(ID, "cardSize", { scope: "user", config: false, type: String, default: "small" });
  game.settings.register(ID, "favorites", { scope: "user", config: false, type: Object,
    default: { ids: [], first: false } });
});

Hooks.once("ready", () => {
  renderPins();
  window.addEventListener("resize", renderPins);
});

Hooks.on("renderSceneControls", (_app, html) => {
  const layers = html.querySelector("menu#scene-controls-layers");
  if (!layers || layers.querySelector(".npc-gallery-launch")) return;
  const launch = button("", () => (gallery ??= new Gallery()).render({ force: true }),
    "control ui-control layer icon fa-solid fa-address-card npc-gallery-launch");
  launch.ariaLabel = "Галерея NPC";
  launch.dataset.tooltip = "Галерея NPC";
  layers.append(element("li", {}, launch));
});
