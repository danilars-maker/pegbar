/*
 * Pegbar by Coffee Cat — timeline de animação frame a frame e ferramentas
 * de animação para Photoshop (UXP).
 * Criado por Danila Ribeiro / Coffee Cat Studio.
 *
 * Modelo:
 *   - Uma animação é um grupo de camadas cujo nome começa com "[ANIM]".
 *   - Cada camada filha direta do grupo é um frame (desenho).
 *   - Ordem: a camada de BAIXO é o frame 1; a de cima é o último.
 *   - Exposição (hold) fica no nome da camada: "F003 [x2]" = frame em 2.
 *   - Etiquetas = as cores de camada do próprio Photoshop.
 */

const { entrypoints, storage } = require("uxp");
const photoshop = require("photoshop");
const { app, core, action, imaging, constants } = photoshop;

// ---------------------------------------------------------------- constantes

const ANIM_PREFIX = "[ANIM]";
const THUMB_H = 64; // altura em que as miniaturas são geradas
const HEAD_W = 130; // largura do nome do grupo na timeline

const LABELS = [
  { key: "none", name: "Sem cor", css: "#5a5a5a" },
  { key: "red", name: "Vermelho", css: "#e05656" },
  { key: "orange", name: "Laranja", css: "#e8964a" },
  { key: "yellowColor", name: "Amarelo", css: "#e3d04f" },
  { key: "grain", name: "Verde", css: "#6cc46c" },
  { key: "blue", name: "Azul", css: "#5b8fe0" },
  { key: "violet", name: "Violeta", css: "#a77ad9" },
  { key: "gray", name: "Cinza", css: "#9a9a9a" },
];
const LABEL_CSS = Object.fromEntries(LABELS.map((l) => [l.key, l.css]));

const ONION_COLORS = {
  red: [230, 50, 50],
  orange: [235, 140, 30],
  green: [30, 160, 60],
  blue: [40, 100, 230],
  violet: [150, 70, 210],
};
const ONION_CSS = {
  red: "#e63232",
  orange: "#eb8c1e",
  green: "#1ea03c",
  blue: "#2864e6",
  violet: "#9646d2",
};

// ---------------------------------------------------------------- estado

const DEFAULT_SETTINGS = {
  onion: {
    enabled: true,
    keysOnly: false,
    before: 1,
    after: 1,
    opacity: 35,
    tint: true,
    falloff: true,
    colorBefore: "red",
    colorAfter: "green",
  },
  fps: 12,
  loop: true,
  slotW: 40,
  defaultHold: 2,
  lang: "auto",
  rotStep: 15,
  scaleStep: 10,
  showPivot: true,
  toolsOpen: true,
  toolsTab: "pivot",
  playMode: "loop", // loop | pingpong | once
  poseTest: false,
  syncGroups: false,
  lightTable: false,
  lightOpacity: 30,
  stStep: 5,
  fieldGuide: "none",
  tcCount: 3,
  tcEase: "linear",
  tcOrient: "vertical",
  tcLength: 200,
  repeatCount: 2,
  exportOnePerDrawing: false,
  exportFormat: "png",
  gifScale: 50,
  thumbFit: "drawing",
  thumbH: 48,
  flipCount: 3,
  showAllRows: true,
};

const S = {
  settings: loadSettings(),
  docId: null,
  groupId: null,
  groupByDoc: {},
  groups: [],
  groupColor: "none",
  rows: [], // todas as linhas de animação (grupos [ANIM])
  frames: [], // {id, name, base, hold, color, visible}
  current: 0,
  selected: new Set(), // ids
  anchor: null, // índice para seleção com shift
  thumbs: new Map(), // id -> dataURL | null
  previews: new Map(), // id -> dataURL grande para o play
  tintKey: new Map(), // id -> nome da cor de cebola aplicada
  clipboard: { mode: null, ids: [], docId: null },
  busy: false,
  cutMode: false,
  playing: false,
  stopRequested: false,
  quietUntil: 0,
};

function loadSettings() {
  try {
    const raw = (localStorage.getItem("pegbarSettings") || localStorage.getItem("fofoTimelineSettings"));
    if (raw) {
      const s = JSON.parse(raw);
      return {
        ...DEFAULT_SETTINGS,
        ...s,
        onion: { ...DEFAULT_SETTINGS.onion, ...(s.onion || {}) },
      };
    }
  } catch (e) {
    /* ignora */
  }
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
}

function saveSettings() {
  try {
    localStorage.setItem("pegbarSettings", JSON.stringify(S.settings));
  } catch (e) {
    /* ignora */
  }
}

// ---------------------------------------------------------------- idioma

let LANG = "pt";
const I18N_TABLE = typeof I18N !== "undefined" ? I18N : {};
const I18N_PATTERNS = Object.keys(I18N_TABLE)
  .filter((k) => k.includes("{0}"))
  .map((k) => {
    const esc = k.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\\\{(\d)\\\}|\{(\d)\}/g, "(.+?)");
    return { re: new RegExp("^" + esc + "$"), tr: I18N_TABLE[k] };
  });

// Traduz um texto em português para o idioma escolhido (mantém o original se não houver tradução)
function tr(msg) {
  if (LANG === "pt" || msg === null || msg === undefined) return msg;
  const li = LANG === "en" ? 0 : 1;
  const full = String(msg);
  const k = full.trim();
  if (!k) return msg;
  if (I18N_TABLE[k]) return full.replace(k, I18N_TABLE[k][li]);
  for (const p of I18N_PATTERNS) {
    const m = k.match(p.re);
    if (m) {
      let out = p.tr[li];
      m.slice(1).forEach((v, i) => {
        out = out.split(`{${i}}`).join(tr(v));
      });
      return full.replace(k, out);
    }
  }
  return msg;
}

function hostLang() {
  try {
    const loc = String(require("uxp").host.uiLocale || "").toLowerCase();
    if (loc.startsWith("pt")) return "pt";
    if (loc.startsWith("es")) return "es";
    if (loc) return "en";
  } catch (e) {
    /* sem informação do Photoshop */
  }
  return "pt";
}

// Guarda os textos originais (português) do painel e troca pelo idioma escolhido
const staticTexts = [];
const SKIP_IDS = new Set(["holdValue", "onionOpacityVal", "lightOpacityVal", "flipValue", "pivotInfo", "stState", "status", "labels", "groupLabels", "swBefore", "swAfter", "groupSelect", "ruler", "track", "langSelect", "diagText", "aboutVersion"]);
function collectStatic(el) {
  if (!el || (el.id && SKIP_IDS.has(el.id))) return;
  if (el.getAttribute && el.getAttribute("title")) {
    if (!el.getAttribute("data-pt-title")) el.setAttribute("data-pt-title", el.getAttribute("title"));
  }
  for (const n of Array.from(el.childNodes || [])) {
    if (n.nodeType === 3) {
      if (n.nodeValue && n.nodeValue.trim()) staticTexts.push({ node: n, pt: n.nodeValue });
    } else if (n.nodeType === 1 && n.tagName !== "SCRIPT") {
      collectStatic(n);
    }
  }
}
function applyLanguage() {
  for (const t of staticTexts) t.node.nodeValue = tr(t.pt);
  document.querySelectorAll("[data-pt-title]").forEach((el) => el.setAttribute("title", tr(el.getAttribute("data-pt-title"))));
}
function translateMenu() {
  try {
    const panel = entrypoints.getPanel("timeline");
    const items = { about: "Sobre o Pegbar", site: "Site do Pegbar", coffee: "Me pague um café" };
    for (const id of Object.keys(items)) {
      const it = panel.menuItems.getItem(id);
      if (it) it.label = tr(items[id]);
    }
  } catch (e) {
    /* versões sem menu dinâmico */
  }
}

function setLanguage(lang) {
  LANG = ["pt", "en", "es"].includes(lang) ? lang : "pt";
  translateMenu();
  S.settings.lang = LANG;
  saveSettings();
  applyLanguage();
  renderSwatches();
  renderShiftTrace();
  render();
}

// ---------------------------------------------------------------- utilidades

const $ = (id) => document.getElementById(id);
function activeDoc() {
  try {
    return app.activeDocument || null;
  } catch (e) {
    return null;
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function status(msg, isError = false) {
  const el = $("status");
  if (!el) return;
  hintShown = false;
  msg = tr(msg);
  el.textContent = msg || "";
  el.className = isError ? "error" : "";
  if (msg && !isError) {
    clearTimeout(status._t);
    status._t = setTimeout(() => {
      if (el.textContent === msg) el.textContent = "";
    }, 3500);
  }
}

function isGroup(layer) {
  return layer && layer.kind === constants.LayerKind.GROUP;
}

function walk(layers, out) {
  for (const l of Array.from(layers || [])) {
    out.push(l);
    if (isGroup(l)) walk(l.layers, out);
  }
  return out;
}

function allLayers(doc) {
  return walk(doc.layers, []);
}

function findLayer(doc, id) {
  return allLayers(doc).find((l) => l.id === id) || null;
}

function animGroups(doc) {
  return allLayers(doc).filter(
    (l) => isGroup(l) && l.name.trim().toUpperCase().startsWith(ANIM_PREFIX)
  );
}

// Nome da camada: "F003 [x2] {K}" = frame 3, em 2, marcado como chave.
// Marcas: K = chave, B = extremo (breakdown), I = intervalo.
function parseName(name) {
  let rest = name;
  let mark = "";
  const mm = rest.match(/^(.*?)\s*\{([KBI])\}\s*$/i);
  if (mm) {
    rest = mm[1];
    mark = mm[2].toUpperCase();
  }
  const m = rest.match(/^(.*?)\s*\[x(\d+)\]\s*$/i);
  if (m) return { base: m[1], hold: Math.max(1, parseInt(m[2], 10) || 1), mark };
  return { base: rest, hold: 1, mark };
}

function makeName(base, hold, mark = "") {
  let n = hold > 1 ? `${base} [x${hold}]` : base;
  if (mark) n += ` {${mark}}`;
  return n;
}

function isKeyMark(m) {
  return m === "K" || m === "B";
}

function nextFrameNumber() {
  let max = 0;
  for (const f of S.frames) {
    const m = f.base.match(/(\d+)/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return Math.max(max, S.frames.length) + 1;
}

function frameLabel(n) {
  return "F" + String(n).padStart(3, "0");
}

function targetIds() {
  if (S.selected.size) {
    return S.frames.filter((f) => S.selected.has(f.id)).map((f) => f.id);
  }
  const f = S.frames[S.current];
  return f ? [f.id] : [];
}

// batchPlay com opções padrão
async function bp(cmds) {
  const arr = Array.isArray(cmds) ? cmds : [cmds];
  for (const c of arr) {
    if (!c._options) c._options = { dialogOptions: "dontDisplay" };
  }
  return action.batchPlay(arr, {});
}

function bpFailed(res) {
  return !res || !res[0] || res[0]._obj === "error";
}

async function selectLayerById(id) {
  return bp({
    _obj: "select",
    _target: [{ _ref: "layer", _id: id }],
    makeVisible: false,
  });
}

// Executa algo em modo modal com um único passo de histórico
async function modal(name, fn, { history = true } = {}) {
  name = tr(name);
  const doc = activeDoc();
  if (!doc) throw new Error("Nenhum documento aberto.");
  S.busy = true;
  try {
    return await core.executeAsModal(
      async (ctx) => {
        let sid = null;
        if (history) {
          sid = await ctx.hostControl.suspendHistory({ documentID: doc.id, name });
        }
        try {
          const r = await fn(ctx, doc);
          if (sid !== null) await ctx.hostControl.resumeHistory(sid, true);
          return r;
        } catch (e) {
          if (sid !== null) await ctx.hostControl.resumeHistory(sid, true);
          throw e;
        }
      },
      { commandName: name }
    );
  } finally {
    S.busy = false;
    S.quietUntil = Date.now() + 600;
  }
}

async function safe(fn) {
  try {
    await fn();
  } catch (e) {
    console.error(e);
    status(e && e.message ? e.message : String(e), true);
  }
}

// ---------------------------------------------------------------- leitura

async function readColors(ids) {
  if (!ids.length) return [];
  try {
    const res = await bp(
      ids.map((id) => ({
        _obj: "get",
        _target: [{ _property: "color" }, { _ref: "layer", _id: id }],
      }))
    );
    return res.map((r) => (r && r.color && r.color._value) || "none");
  } catch (e) {
    return ids.map(() => "none");
  }
}

// Relê os frames do grupo ativo (pode ser chamada dentro ou fora de modal)
async function loadFrames(doc) {
  if (!doc) {
    S.frames = [];
    S.groups = [];
    return null;
  }
  if (S.docId !== doc.id) {
    S.docId = doc.id;
    S.groupId = S.groupByDoc[doc.id] || null;
    S.thumbs.clear();
    S.previews.clear();
    S.tintKey.clear();
    S.selected.clear();
    S.current = 0;
  }
  const groups = animGroups(doc);
  S.groups = groups.map((g) => ({ id: g.id, name: g.name }));
  const group = groups.find((g) => g.id === S.groupId) || groups[0] || null;
  S.groupId = group ? group.id : null;
  S.groupByDoc[doc.id] = S.groupId;
  if (!group) {
    S.frames = [];
    S.rows = [];
    return null;
  }
  S.groupColor = (await readColors([group.id]))[0] || "none";
  const prevId = S.frames[S.current] ? S.frames[S.current].id : null;
  const kids = Array.from(group.layers || []).reverse(); // baixo -> cima
  const colors = await readColors(kids.map((k) => k.id));
  S.frames = kids.map((l, i) => {
    const p = parseName(l.name);
    return {
      id: l.id,
      name: l.name,
      base: p.base,
      hold: p.hold,
      mark: p.mark,
      color: colors[i] || "none",
      visible: l.visible,
    };
  });
  await buildRows(groups, group);
  let idx = S.frames.findIndex((f) => f.id === prevId);
  if (idx < 0) idx = S.frames.findIndex((f) => f.visible);
  S.current = clamp(idx < 0 ? 0 : idx, 0, Math.max(0, S.frames.length - 1));
  const valid = new Set(S.frames.map((f) => f.id));
  for (const id of Array.from(S.selected)) if (!valid.has(id)) S.selected.delete(id);
  return group;
}

// Lê todos os grupos [ANIM] como linhas da timeline (na ordem do painel Camadas)
async function buildRows(groups, active) {
  const others = groups.filter((g) => g.id !== active.id);
  const ids = [];
  const kidsBy = new Map();
  for (const g of others) {
    const kids = Array.from(g.layers || []).reverse();
    kidsBy.set(g.id, kids);
    ids.push(g.id);
    for (const k of kids) ids.push(k.id);
  }
  const colors = ids.length ? await readColors(ids) : [];
  const colorOf = new Map(ids.map((id, i) => [id, colors[i] || "none"]));
  S.rows = groups.map((g) => {
    if (g.id === active.id) return { id: g.id, name: g.name, color: S.groupColor, frames: S.frames, active: true };
    return {
      id: g.id,
      name: g.name,
      color: colorOf.get(g.id) || "none",
      visible: g.visible,
      active: false,
      frames: kidsBy.get(g.id).map((l) => {
        const p = parseName(l.name);
        return { id: l.id, name: l.name, base: p.base, hold: p.hold, mark: p.mark, color: colorOf.get(l.id) || "none" };
      }),
    };
  });
}

// Troca o grupo que está sendo editado, mantendo o mesmo tempo da timeline
async function switchGroup(gid, frameIndex = null) {
  if (gid === S.groupId) {
    if (frameIndex !== null) await goTo(frameIndex);
    return;
  }
  await endShiftTrace();
  const tick = S.frames.length ? startTickOf(S.frames, S.current) : 0;
  const oldId = S.groupId;
  const row = S.rows.find((r) => r.id === gid);
  await modal("Trocar de grupo", async (ctx, doc) => {
    // o grupo antigo fica "limpo": só o desenho do tempo atual, sem cebola
    await settleGroup(doc, oldId, tick);
    S.groupId = gid;
    S.groupByDoc[doc.id] = gid;
    S.frames = [];
    S.selected.clear();
    await loadFrames(doc);
    let idx = frameIndex;
    if (idx === null) {
      const map = ticksOf(S.frames);
      idx = map.length ? map[Math.min(tick, map.length - 1)] : 0;
    }
    S.current = clamp(idx, 0, Math.max(0, S.frames.length - 1));
    if (S.frames.length) await applyView(doc);
  });
  render();
  queueThumbs();
  if (row) status(`Editando: ${groupDisplayName(row.name)}`);
}

async function refresh({ followActive = false } = {}) {
  const doc = activeDoc();
  if (!doc) {
    S.docId = null;
    S.frames = [];
    S.groups = [];
    render();
    return;
  }
  await loadFrames(doc);
  if (followActive) {
    const act = Array.from(doc.activeLayers || [])[0];
    if (act) {
      const ai = S.frames.findIndex((f) => f.id === act.id);
      if (ai >= 0) S.current = ai;
    }
  }
  render();
  queueThumbs();
}

// ---------------------------------------------------------------- casca de cebola

function tintCmd(id, colorName, enabled = true) {
  const rgb = ONION_COLORS[colorName] || ONION_COLORS.red;
  return {
    _obj: "set",
    _target: [
      { _ref: "property", _property: "layerEffects" },
      { _ref: "layer", _id: id },
    ],
    to: {
      _obj: "layerEffects",
      scale: { _unit: "percentUnit", _value: 100 },
      solidFill: {
        _obj: "solidFill",
        enabled: enabled,
        present: true,
        showInDialog: true,
        mode: { _enum: "blendMode", _value: "normal" },
        opacity: { _unit: "percentUnit", _value: 100 },
        color: { _obj: "RGBColor", red: rgb[0], grain: rgb[1], blue: rgb[2] },
      },
    },
  };
}

function tintTarget(cmd, byOrdinal) {
  cmd._target = [
    { _ref: "property", _property: "layerEffects" },
    byOrdinal ? { _ref: "layer", _enum: "ordinal", _value: "targetEnum" } : cmd._target[1],
  ];
  return cmd;
}

// Executa um comando de estilo pela id; se falhar, seleciona a camada e tenta de novo.
// Nunca deixa o erro travar a navegação.
async function runFx(id, makeCmd) {
  try {
    const res = await bp(makeCmd());
    if (!bpFailed(res)) return true;
  } catch (e) {
    /* tenta o plano B */
  }
  try {
    await selectLayerById(id);
    const res = await bp(tintTarget(makeCmd(), true));
    return !bpFailed(res);
  } catch (e) {
    console.warn("estilo de cebola falhou", id, e);
    return false;
  }
}

async function setTint(id, colorName) {
  await runFx(id, () => tintCmd(id, colorName, true));
  S.tintKey.set(id, colorName);
}

// Desliga a sobreposição de cor (sem apagar estilos)
async function clearTint(id) {
  await runFx(id, () => tintCmd(id, "red", false));
  S.tintKey.delete(id);
}

// Lê se a camada está com a nossa cor de cebola ligada (sobra de outra sessão)
async function hasOnionTint(id) {
  try {
    const res = await bp({
      _obj: "get",
      _target: [{ _property: "layerEffects" }, { _ref: "layer", _id: id }],
    });
    const fx = res && res[0] && res[0].layerEffects;
    return !!(fx && fx.solidFill && fx.solidFill.enabled && isOnionFill(fx));
  } catch (e) {
    return false;
  }
}

// Distância de um frame até o atual na cebola (null = fora da cebola)
function onionDist(i) {
  const cur = S.current;
  if (i === cur) return 0;
  const o = S.settings.onion;
  if (!o.keysOnly) return i - cur;
  if (!S.frames[i] || !isKeyMark(S.frames[i].mark)) return null;
  // conta só as chaves/extremos entre o atual e o frame i
  let d = 0;
  if (i < cur) {
    for (let k = cur - 1; k >= i; k--) if (isKeyMark(S.frames[k].mark)) d--;
  } else {
    for (let k = cur + 1; k <= i; k++) if (isKeyMark(S.frames[k].mark)) d++;
  }
  return d;
}

function onionOpacity(d, n) {
  const o = S.settings.onion;
  if (!o.falloff || n <= 1) return o.opacity;
  return Math.max(5, Math.round(o.opacity * (1 - (d - 1) / n)));
}

// Mostra o frame atual + cebola, esconde o resto. Precisa estar em modal.
async function applyView(doc, { select = true } = {}) {
  const n = S.frames.length;
  if (!n) return;
  const group = findLayer(doc, S.groupId);
  if (!group) return;
  if (!group.visible) group.visible = true;

  const byId = new Map(Array.from(group.layers).map((l) => [l.id, l]));
  const o = S.settings.onion;
  const cur = S.current;

  for (let i = 0; i < n; i++) {
    const f = S.frames[i];
    const layer = byId.get(f.id);
    if (!layer) continue;
    const d = onionDist(i);
    let vis = false;
    let op = 100;
    let color = null;

    if (d === null) {
      vis = false;
    } else if (d === 0) {
      vis = true;
    } else if (o.enabled && d < 0 && -d <= o.before) {
      vis = true;
      op = onionOpacity(-d, o.before);
      color = o.colorBefore;
    } else if (o.enabled && d > 0 && d <= o.after) {
      vis = true;
      op = onionOpacity(d, o.after);
      color = o.colorAfter;
    }

    if (layer.visible !== vis) layer.visible = vis;
    f.visible = vis;
    if (!vis) continue;

    if (Math.round(layer.opacity) !== op) layer.opacity = op;

    if (color && o.tint) {
      if (S.tintKey.get(f.id) !== color) await setTint(f.id, color);
    } else if (S.tintKey.has(f.id)) {
      await clearTint(f.id);
    }
  }

  const curId = S.frames[cur].id;
  if (!S.tintKey.has(curId) && (await hasOnionTint(curId))) await clearTint(curId);
  await syncOtherGroups(doc, startTickOf(S.frames, cur));
  if (select) await selectLayerById(curId);
}

// ---- outros grupos: sincronizar no mesmo tempo e mesa de luz

function ticksOf(frames) {
  const map = [];
  frames.forEach((f, i) => {
    for (let k = 0; k < f.hold; k++) map.push(i);
  });
  return map;
}

function startTickOf(frames, idx) {
  let t = 0;
  for (let i = 0; i < idx && i < frames.length; i++) t += frames[i].hold;
  return t;
}

// Teste de poses: cada chave/extremo fica na tela até a próxima
function poseMap(frames) {
  const map = [];
  let last = -1;
  frames.forEach((f, i) => {
    if (isKeyMark(f.mark)) last = i;
    const show = last >= 0 ? last : i;
    for (let k = 0; k < f.hold; k++) map.push(show);
  });
  return map;
}

function otherGroupsData(doc) {
  return animGroups(doc)
    .filter((g) => g.id !== S.groupId)
    .map((g) => ({
      group: g,
      frames: Array.from(g.layers || [])
        .reverse()
        .map((l) => ({ id: l.id, hold: parseName(l.name).hold, layer: l })),
    }));
}

function frameAtTick(frames, map, t) {
  if (!frames.length || !map.length) return null;
  return frames[map[Math.min(t, map.length - 1)]];
}

async function syncOtherGroups(doc, tick) {
  const st = S.settings;
  const others = otherGroupsData(doc);
  const cg = findLayer(doc, S.groupId);
  if (cg && Math.round(cg.opacity) !== 100) cg.opacity = 100;
  for (const o of others) {
    const op = st.lightTable ? st.lightOpacity : 100;
    if (Math.round(o.group.opacity) !== op) o.group.opacity = op;
    if (!st.syncGroups) continue;
    if (!o.group.visible) o.group.visible = true;
    const target = frameAtTick(o.frames, ticksOf(o.frames), tick);
    for (const f of o.frames) {
      const vis = !!target && f.id === target.id;
      if (f.layer.visible !== vis) f.layer.visible = vis;
      if (vis) {
        if (S.tintKey.has(f.id)) await clearTint(f.id);
        if (Math.round(f.layer.opacity) !== 100) f.layer.opacity = 100;
      }
    }
  }
}

// Tira cor/transparência de cebola de todos os frames do grupo
async function cleanOnion(doc) {
  const group = findLayer(doc, S.groupId);
  if (!group) return;
  for (const layer of Array.from(group.layers)) {
    if (Math.round(layer.opacity) !== 100) layer.opacity = 100;
    const res = await bp({
      _obj: "get",
      _target: [{ _property: "layerEffects" }, { _ref: "layer", _id: layer.id }],
    });
    const fx = res && res[0] && res[0].layerEffects;
    if (S.tintKey.has(layer.id) || (fx && fx.solidFill && fx.solidFill.enabled && isOnionFill(fx))) {
      await clearTint(layer.id);
    }
  }
  S.tintKey.clear();
}

function isOnionFill(fx) {
  // só limpa estilos que sejam apenas a cor de sobreposição (a nossa)
  const keys = Object.keys(fx).filter((k) => !k.startsWith("_") && k !== "scale" && k !== "masterFXSwitch");
  return keys.length === 1 && keys[0] === "solidFill";
}

// ---------------------------------------------------------------- miniaturas

let blankThumb = null;
let thumbError = null; // primeiro erro ao gerar miniaturas (para avisar)
let thumbInfo = null; // detalhes da última miniatura (diagnóstico)
const thumbFrames = new Map(); // área usada nas miniaturas de cada grupo

// ---- PNG feito pelo próprio plugin (não depende de codificador do Photoshop)
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function base64(bytes) {
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  if (i < bytes.length) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : "=") + "=";
  }
  return out;
}
function pngFromRGB(rgb, w, h) {
  // linhas com filtro 0
  const rowLen = w * 3 + 1;
  const raw = new Uint8Array(rowLen * h);
  for (let y = 0; y < h; y++) {
    raw[y * rowLen] = 0;
    raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * rowLen + 1);
  }
  // zlib com blocos "stored" (sem compressão)
  const blocks = Math.max(1, Math.ceil(raw.length / 65535));
  const z = new Uint8Array(2 + raw.length + blocks * 5 + 4);
  let o = 0;
  z[o++] = 0x78;
  z[o++] = 0x01;
  for (let bI = 0; bI < blocks; bI++) {
    const start = bI * 65535;
    const len = Math.min(65535, raw.length - start);
    z[o++] = bI === blocks - 1 ? 1 : 0;
    z[o++] = len & 0xff;
    z[o++] = (len >> 8) & 0xff;
    z[o++] = ~len & 0xff;
    z[o++] = (~len >> 8) & 0xff;
    z.set(raw.subarray(start, start + len), o);
    o += len;
  }
  let a1 = 1;
  let a2 = 0;
  for (let i = 0; i < raw.length; i++) {
    a1 = (a1 + raw[i]) % 65521;
    a2 = (a2 + a1) % 65521;
  }
  const ad = ((a2 << 16) | a1) >>> 0;
  z[o++] = (ad >>> 24) & 0xff;
  z[o++] = (ad >>> 16) & 0xff;
  z[o++] = (ad >>> 8) & 0xff;
  z[o++] = ad & 0xff;
  const chunk = (type, data) => {
    const c = new Uint8Array(12 + data.length);
    const dv = new DataView(c.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) c[4 + i] = type.charCodeAt(i);
    c.set(data, 8);
    dv.setUint32(8 + data.length, crc32(c.subarray(4, 8 + data.length)));
    return c;
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = 8; // 8 bits
  ihdr[9] = 2; // RGB
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", z.subarray(0, o)),
    chunk("IEND", new Uint8Array(0)),
  ];
  const total = parts.reduce((acc, x) => acc + x.length, 0);
  const png = new Uint8Array(total);
  let q = 0;
  for (const x of parts) {
    png.set(x, q);
    q += x.length;
  }
  return png;
}

async function encodeRGB(buf, w, h) {
  return "data:image/png;base64," + base64(pngFromRGB(buf, w, h));
}

function num(v) {
  return typeof v === "object" && v !== null ? Number(v._value !== undefined ? v._value : v.value) : Number(v);
}

// Pede os pixels da camada ao Photoshop, tentando formas diferentes (as versões variam)
async function layerPixels(doc, layer, rect, th) {
  const tries = [
    { documentID: doc.id, layerID: layer.id, sourceBounds: rect, targetSize: { height: th }, componentSize: 8, colorSpace: "RGB" },
    { documentID: doc.id, layerID: layer.id, targetSize: { height: th }, colorSpace: "RGB" },
    { documentID: doc.id, layerID: layer.id },
  ];
  let lastErr = null;
  for (const opt of tries) {
    try {
      return await imaging.getPixels(opt);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("getPixels");
}

// Miniatura de uma camada. `frame` é a área mostrada (o desenho do grupo todo, ou a página).
// Reduz guardando o pixel mais "pintado" de cada bloco, para os traços finos não sumirem.
async function makeThumb(doc, layer, H = THUMB_H, frame = null) {
  const dw0 = num(doc.width);
  const dh0 = num(doc.height);
  const fr = frame || { left: 0, top: 0, right: dw0, bottom: dh0 };
  const fw = Math.max(1, fr.right - fr.left);
  const fh = Math.max(1, fr.bottom - fr.top);
  const scale = H / fh;
  const W = clamp(Math.round(fw * scale), 8, H * 4);
  const sx = W / fw;
  const out = new Uint8Array(W * H * 3).fill(255);

  const b = layer.bounds;
  const left = clamp(Math.floor(num(b.left)), 0, dw0);
  const top = clamp(Math.floor(num(b.top)), 0, dh0);
  const right = clamp(Math.ceil(num(b.right)), 0, dw0);
  const bottom = clamp(Math.ceil(num(b.bottom)), 0, dh0);
  if (!(right - left >= 1 && bottom - top >= 1)) {
    thumbInfo = null;
    return encodeRGB(out, W, H);
  }

  // pede ~3x a resolução final da área do desenho (ou o tamanho real, se for menor)
  const want = Math.max(1, Math.round((bottom - top) * scale * 3));
  const th = Math.min(bottom - top, want);
  const res = await layerPixels(doc, layer, { left, top, right, bottom }, th);
  const img = res.imageData;
  try {
    const sb0 = res.sourceBounds || { left, top, right, bottom };
    const sb = { left: num(sb0.left), top: num(sb0.top), right: num(sb0.right), bottom: num(sb0.bottom) };
    const data = await img.getData({ chunky: true });
    const iw = img.width;
    const ih = img.height;
    const c = img.components || Math.round(data.length / (iw * ih));
    thumbInfo = { iw, ih, c, bytes: data.length, sb, ink: 0 };
    // retângulo da camada dentro da miniatura
    const dx0 = (sb.left - fr.left) * sx;
    const dy0 = (sb.top - fr.top) * scale;
    const dw = Math.max(1e-6, (sb.right - sb.left) * sx);
    const dh = Math.max(1e-6, (sb.bottom - sb.top) * scale);
    const x0 = Math.max(0, Math.floor(dx0));
    const y0 = Math.max(0, Math.floor(dy0));
    const x1 = Math.min(W, Math.ceil(dx0 + dw));
    const y1 = Math.min(H, Math.ceil(dy0 + dh));
    for (let ty = y0; ty < y1; ty++) {
      const syA = clamp(Math.floor(((ty - dy0) / dh) * ih), 0, ih - 1);
      const syB = clamp(Math.ceil(((ty + 1 - dy0) / dh) * ih), syA + 1, ih);
      for (let tx = x0; tx < x1; tx++) {
        const sxA = clamp(Math.floor(((tx - dx0) / dw) * iw), 0, iw - 1);
        const sxB = clamp(Math.ceil(((tx + 1 - dx0) / dw) * iw), sxA + 1, iw);
        // o pixel mais pintado do bloco
        let best = -1;
        let bi = 0;
        for (let yy = syA; yy < syB; yy++) {
          for (let xx = sxA; xx < sxB; xx++) {
            const si = (yy * iw + xx) * c;
            let ink;
            if (c >= 4) ink = data[si + 3] * (765 - data[si] - data[si + 1] - data[si + 2] + 1);
            else if (c === 3) ink = 765 - data[si] - data[si + 1] - data[si + 2];
            else if (c === 2) ink = data[si + 1] * (256 - data[si]);
            else ink = 255 - data[si];
            if (ink > best) {
              best = ink;
              bi = si;
            }
          }
        }
        const di = (ty * W + tx) * 3;
        if (c >= 4) {
          const a = data[bi + 3] / 255;
          if (a > 0.05) thumbInfo.ink++;
          out[di] = data[bi] * a + 255 * (1 - a);
          out[di + 1] = data[bi + 1] * a + 255 * (1 - a);
          out[di + 2] = data[bi + 2] * a + 255 * (1 - a);
        } else if (c === 3) {
          out[di] = data[bi];
          out[di + 1] = data[bi + 1];
          out[di + 2] = data[bi + 2];
        } else if (c === 2) {
          const a = data[bi + 1] / 255;
          out[di] = out[di + 1] = out[di + 2] = data[bi] * a + 255 * (1 - a);
        } else {
          out[di] = out[di + 1] = out[di + 2] = data[bi];
        }
      }
    }
  } finally {
    try {
      img.dispose();
    } catch (e) {
      /* ignora */
    }
  }
  return encodeRGB(out, W, H);
}

// Área mostrada nas miniaturas de um grupo: o desenho de todos os frames (com folga), ou a página
function thumbFrameFor(doc, groupId) {
  const dw0 = num(doc.width);
  const dh0 = num(doc.height);
  const page = { left: 0, top: 0, right: dw0, bottom: dh0 };
  if (S.settings.thumbFit === "page") return page;
  const g = findLayer(doc, groupId);
  if (!g) return page;
  let L = Infinity;
  let T = Infinity;
  let R = -Infinity;
  let B = -Infinity;
  for (const l of Array.from(g.layers || [])) {
    const b = l.bounds;
    const bl = num(b.left);
    const bt = num(b.top);
    const br = num(b.right);
    const bb = num(b.bottom);
    if (!(br - bl >= 1 && bb - bt >= 1)) continue;
    L = Math.min(L, bl);
    T = Math.min(T, bt);
    R = Math.max(R, br);
    B = Math.max(B, bb);
  }
  if (!isFinite(L)) return page;
  const pad = Math.max(R - L, B - T) * 0.08 + 4;
  return {
    left: clamp(L - pad, 0, dw0),
    top: clamp(T - pad, 0, dh0),
    right: clamp(R + pad, 0, dw0),
    bottom: clamp(B + pad, 0, dh0),
  };
}

let thumbTimer = null;
function queueThumbs(ids) {
  if (ids) for (const id of ids) {
    S.thumbs.delete(id);
    S.previews.delete(id);
  }
  clearTimeout(thumbTimer);
  thumbTimer = setTimeout(buildThumbs, 200);
}

// Lê os pixels com a camada visível (o Photoshop pode entregar camadas ocultas em branco).
// A visibilidade volta ao normal no fim (o passo de histórico é descartado).
async function thumbWithVisible(doc, layer, frame = null) {
  const changed = [];
  let el = layer;
  while (el && el.id !== undefined) {
    if (el.visible === false) {
      el.visible = true;
      changed.push(el);
    }
    el = el.parent;
  }
  try {
    return await makeThumb(doc, layer, THUMB_H, frame);
  } finally {
    for (const c of changed) {
      try {
        c.visible = false;
      } catch (e) {
        /* ignora */
      }
    }
  }
}

async function buildThumbs() {
  if (S.busy || S.playing || scrub.active || drag.active || resize.active) {
    thumbTimer = setTimeout(buildThumbs, 500);
    return;
  }
  const doc = activeDoc();
  if (!doc) return;
  const rowsToCheck = S.settings.showAllRows && S.rows.length ? S.rows : [{ id: S.groupId, frames: S.frames }];
  // se a área do desenho de um grupo mudou, refaz todas as miniaturas dele (mesmo enquadramento)
  for (const r of rowsToCheck) {
    let fr = null;
    try {
      fr = thumbFrameFor(doc, r.id);
    } catch (e) {
      fr = null;
    }
    const old = thumbFrames.get(r.id);
    if (fr && (!old || Math.abs(old.left - fr.left) > 2 || Math.abs(old.top - fr.top) > 2 || Math.abs(old.right - fr.right) > 2 || Math.abs(old.bottom - fr.bottom) > 2)) {
      for (const f of r.frames) S.thumbs.delete(f.id);
      thumbFrames.set(r.id, fr);
    }
  }
  const all = rowsToCheck.flatMap((r) => r.frames);
  const missing = (all.length ? all : S.frames).filter((f) => !S.thumbs.has(f.id)).map((f) => f.id);
  if (!missing.length) return;
  S.busy = true;
  let made = 0;
  let empty = 0;
  try {
    await core.executeAsModal(
      async (ctx) => {
        const sid = await ctx.hostControl.suspendHistory({ documentID: doc.id, name: tr("Pegbar: miniaturas") });
        try {
          const frames = new Map();
          for (const id of missing) {
            const layer = findLayer(doc, id);
            if (!layer) continue;
            try {
              thumbInfo = null;
              const gid = layer.parent ? layer.parent.id : S.groupId;
              if (!frames.has(gid)) frames.set(gid, thumbFrames.get(gid) || thumbFrameFor(doc, gid));
              S.thumbs.set(id, await thumbWithVisible(doc, layer, frames.get(gid)));
              made++;
              if (thumbInfo && thumbInfo.ink === 0) empty++;
            } catch (e) {
              console.warn("miniatura falhou", id, e);
              if (!thumbError) {
                thumbError = (e && e.message) || String(e);
                status(tr("Não consegui gerar as miniaturas: ") + thumbError, true);
              }
              S.thumbs.set(id, null);
            }
          }
        } finally {
          await ctx.hostControl.resumeHistory(sid, false);
        }
      },
      { commandName: tr("Pegbar: miniaturas") }
    );
  } catch (e) {
    thumbTimer = setTimeout(buildThumbs, 800);
  } finally {
    S.busy = false;
    S.quietUntil = Date.now() + 400;
  }
  if (made > 2 && empty === made && !thumbError) {
    thumbError = "empty";
    status(tr("As miniaturas vieram vazias. Abra a aba Exportar e clique em Testar miniaturas, e me mande um print."), true);
  }
  render();
}

// Diagnóstico: gera a miniatura do frame atual e mostra cada passo
async function diagnoseThumbs() {
  await ensureLoaded();
  const doc = activeDoc();
  const f = S.frames[S.current];
  const lines = [];
  let url = null;
  S.busy = true;
  try {
    await core.executeAsModal(
      async (ctx) => {
        const sid = await ctx.hostControl.suspendHistory({ documentID: doc.id, name: "diag" });
        try {
          const layer = findLayer(doc, f.id);
          const b = layer.bounds;
          lines.push(`doc ${num(doc.width)}x${num(doc.height)} | camada "${layer.name}" visível=${layer.visible} tipo=${layer.kind}`);
          lines.push(`bounds ${num(b.left)},${num(b.top)} → ${num(b.right)},${num(b.bottom)}`);
          thumbInfo = null;
          const fr = thumbFrameFor(doc, S.groupId);
          lines.push(`área ${Math.round(fr.left)},${Math.round(fr.top)} → ${Math.round(fr.right)},${Math.round(fr.bottom)}`);
          url = await thumbWithVisible(doc, layer, fr);
          if (thumbInfo) lines.push(`pixels ${thumbInfo.iw}x${thumbInfo.ih} comp=${thumbInfo.c} bytes=${thumbInfo.bytes} tinta=${thumbInfo.ink}`);
          else lines.push("pixels: camada vazia (bounds zerados)");
          lines.push(`png ${url ? url.length : 0} caracteres`);
        } catch (e) {
          lines.push("ERRO: " + ((e && e.message) || e));
        } finally {
          await ctx.hostControl.resumeHistory(sid, false);
        }
      },
      { commandName: "Pegbar: diagnóstico" }
    );
  } finally {
    S.busy = false;
  }
  const box = $("diagBox");
  if (box) {
    box.style.display = "flex";
    $("diagText").textContent = lines.join("\n");
    if (url) $("diagImg").src = url;
  }
  if (url) {
    S.thumbs.set(f.id, url);
    render();
  }
}

// ---------------------------------------------------------------- ações

async function goTo(index) {
  if (!S.frames.length) return;
  await endShiftTrace();
  const n = S.frames.length;
  const prevId = S.frames[S.current] ? S.frames[S.current].id : null;
  S.current = clamp(index, 0, n - 1);
  render();
  await modal(`Frame ${S.current + 1}`, async (ctx, doc) => applyView(doc));
  render();
  // o frame que deixamos pode ter sido desenhado: refaz a miniatura dele
  if (prevId && prevId !== S.frames[S.current].id) queueThumbs([prevId]);
}

async function step(delta) {
  await ensureLoaded();
  S.selected.clear();
  const n = S.frames.length;
  if (!n) return;
  let i = S.current + delta;
  if (S.settings.playMode !== "once") i = ((i % n) + n) % n;
  await goTo(clamp(i, 0, n - 1));
}

async function ensureLoaded() {
  const doc = activeDoc();
  if (!doc) throw new Error("Abra um documento primeiro.");
  if (S.docId !== doc.id || !S.frames.length) await refresh();
  if (!S.groupId) throw new Error('Nenhum grupo "[ANIM]" neste documento. Use "+ Grupo" ou "Usar seleção".');
}

async function newFrame(duplicate = false) {
  await ensureLoaded();
  const curFrame = S.frames[S.current];
  const base = frameLabel(nextFrameNumber());
  await modal(duplicate ? "Duplicar frame" : "Novo frame", async (ctx, doc) => {
    const group = findLayer(doc, S.groupId);
    let layer;
    if (!curFrame) {
      layer = await doc.createLayer({ name: makeName(base, S.settings.defaultHold) });
      await layer.move(group, constants.ElementPlacement.PLACEINSIDE);
    } else {
      const cur = findLayer(doc, curFrame.id);
      if (duplicate) {
        if (S.tintKey.has(cur.id)) await clearTint(cur.id);
        layer = await cur.duplicate();
        layer.name = makeName(base, curFrame.hold, curFrame.mark);
      } else {
        await selectLayerById(cur.id);
        layer = await doc.createLayer({ name: makeName(base, S.settings.defaultHold) });
      }
      await layer.move(cur, constants.ElementPlacement.PLACEBEFORE); // acima = depois
    }
    const newId = layer.id;
    await loadFrames(doc);
    S.current = Math.max(0, S.frames.findIndex((f) => f.id === newId));
    S.selected.clear();
    await applyView(doc);
  });
  render();
  queueThumbs();
}

async function deleteFrames() {
  await ensureLoaded();
  const ids = targetIds();
  if (!ids.length) return;
  if (ids.length >= S.frames.length) {
    throw new Error("Não dá para apagar todos os frames. Deixe pelo menos um.");
  }
  await modal(ids.length > 1 ? `Apagar ${ids.length} frames` : "Apagar frame", async (ctx, doc) => {
    const firstIdx = S.frames.findIndex((f) => ids.includes(f.id));
    for (const id of ids) {
      const l = findLayer(doc, id);
      if (l) await l.delete();
      S.thumbs.delete(id);
      S.tintKey.delete(id);
    }
    S.selected.clear();
    await loadFrames(doc);
    S.current = clamp(firstIdx - 1 < 0 ? 0 : firstIdx - 1, 0, S.frames.length - 1);
    await applyView(doc);
  });
  render();
  status(`${ids.length} frame(s) apagado(s). Ctrl+Z desfaz.`);
}

async function moveFrames(dir) {
  await ensureLoaded();
  const ids = targetIds();
  if (!ids.length) return;
  const curId = S.frames[S.current].id;
  await modal("Mover frames", async (ctx, doc) => {
    const order = S.frames.map((f) => f.id);
    const set = new Set(ids);
    const idxs = order.map((id, i) => (set.has(id) ? i : -1)).filter((i) => i >= 0);
    if (dir > 0) idxs.reverse();
    for (const i of idxs) {
      const j = i + dir;
      if (j < 0 || j >= order.length || set.has(order[j])) continue;
      const layer = findLayer(doc, order[i]);
      const other = findLayer(doc, order[j]);
      // camada acima = frame depois
      await layer.move(
        other,
        dir > 0 ? constants.ElementPlacement.PLACEBEFORE : constants.ElementPlacement.PLACEAFTER
      );
      [order[i], order[j]] = [order[j], order[i]];
    }
    await loadFrames(doc);
    S.current = Math.max(0, S.frames.findIndex((f) => f.id === curId));
    await applyView(doc);
  });
  render();
}

async function setHold(delta, absolute = null) {
  await ensureLoaded();
  const ids = targetIds();
  if (!ids.length) return;
  await modal("Exposição", async (ctx, doc) => {
    for (const id of ids) {
      const f = S.frames.find((x) => x.id === id);
      const l = findLayer(doc, id);
      if (!f || !l) continue;
      const hold = clamp(absolute !== null ? absolute : f.hold + delta, 1, 999);
      l.name = makeName(f.base, hold, f.mark);
    }
    await loadFrames(doc);
  });
  render();
}

async function setLabel(key) {
  await ensureLoaded();
  const ids = targetIds();
  if (!ids.length) return;
  await modal("Etiqueta de cor", async () => {
    await bp(
      ids.map((id) => ({
        _obj: "set",
        _target: [{ _ref: "layer", _id: id }],
        to: { _obj: "layer", color: { _enum: "color", _value: key } },
      }))
    );
    const colors = await readColors(ids);
    ids.forEach((id, k) => {
      const f = S.frames.find((x) => x.id === id);
      if (f) f.color = colors[k];
    });
  });
  render();
}

// Aplica a exposição padrão nos frames selecionados, ou em todos se não houver seleção
async function applyDefaultHold() {
  await ensureLoaded();
  const ids = S.selected.size > 1 ? targetIds() : S.frames.map((f) => f.id);
  const hold = S.settings.defaultHold;
  await modal(`Exposição x${hold}`, async (ctx, doc) => {
    for (const id of ids) {
      const f = S.frames.find((x) => x.id === id);
      const l = findLayer(doc, id);
      if (f && l && f.hold !== hold) l.name = makeName(f.base, hold, f.mark);
    }
    await loadFrames(doc);
  });
  render();
  status(`${ids.length} frame(s) em ${hold}.`);
}

async function setGroupColor(key) {
  await ensureLoaded();
  await modal("Cor do grupo", async (ctx, doc) => {
    const ids = [S.groupId, ...S.frames.map((f) => f.id)];
    await bp(
      ids.map((id) => ({
        _obj: "set",
        _target: [{ _ref: "layer", _id: id }],
        to: { _obj: "layer", color: { _enum: "color", _value: key } },
      }))
    );
    await loadFrames(doc);
  });
  render();
}

function groupDisplayName(name) {
  const t = name.trim();
  return t.toUpperCase().startsWith(ANIM_PREFIX) ? t.slice(ANIM_PREFIX.length).trim() : t;
}

function openRename() {
  const g = S.groups.find((x) => x.id === S.groupId);
  if (!g) return;
  $("renameBox").style.display = "flex";
  const inp = $("renameInput");
  inp.value = groupDisplayName(g.name);
  try {
    inp.focus();
    inp.select();
  } catch (e) {
    /* ignora */
  }
}

function closeRename() {
  $("renameBox").style.display = "none";
}

async function applyRename() {
  await ensureLoaded();
  const name = ($("renameInput").value || "").trim();
  if (!name) throw new Error("Digite um nome para o grupo.");
  await modal("Renomear grupo", async (ctx, doc) => {
    const g = findLayer(doc, S.groupId);
    if (g) g.name = `${ANIM_PREFIX} ${name}`;
    await loadFrames(doc);
  });
  closeRename();
  render();
  status(`Grupo renomeado para "${name}".`);
}

function copyFrames(mode) {
  const ids = targetIds();
  if (!ids.length) return;
  S.clipboard = { mode, ids, docId: S.docId };
  render();
  status(
    mode === "cut"
      ? `${ids.length} frame(s) recortado(s). Escolha onde colar e clique em Colar.`
      : `${ids.length} frame(s) copiado(s).`
  );
}

async function pasteFrames() {
  await ensureLoaded();
  const cb = S.clipboard;
  if (!cb.mode || !cb.ids.length) throw new Error("Nada para colar. Recorte ou copie frames antes.");
  if (cb.docId !== S.docId) throw new Error("Por enquanto, só dá para colar frames no mesmo documento.");
  const anchorFrame = S.frames[S.current];
  if (cb.mode === "cut" && cb.ids.includes(anchorFrame.id)) {
    throw new Error("Escolha um frame fora dos recortados para colar depois dele.");
  }
  let pastedIds = [];
  await modal(cb.mode === "cut" ? "Colar frames recortados" : "Colar frames", async (ctx, doc) => {
    let anchor = findLayer(doc, anchorFrame.id);
    // mantém a ordem original da timeline
    const ordered = S.frames.filter((f) => cb.ids.includes(f.id)).map((f) => f.id);
    for (const id of ordered) {
      const src = findLayer(doc, id);
      if (!src) continue;
      let layer = src;
      if (cb.mode === "copy") {
        if (S.tintKey.has(src.id)) await clearTint(src.id);
        layer = await src.duplicate();
        const p = parseName(src.name);
        layer.name = makeName(frameLabel(nextFrameNumber() + pastedIds.length), p.hold, p.mark);
      }
      await layer.move(anchor, constants.ElementPlacement.PLACEBEFORE);
      anchor = layer;
      pastedIds.push(layer.id);
    }
    await loadFrames(doc);
    S.selected = new Set(pastedIds);
    const lastIdx = S.frames.findIndex((f) => f.id === pastedIds[pastedIds.length - 1]);
    S.current = Math.max(0, lastIdx);
    await applyView(doc);
  });
  if (cb.mode === "cut") S.clipboard = { mode: null, ids: [], docId: null };
  render();
  queueThumbs();
  status(`${pastedIds.length} frame(s) colado(s).`);
}

async function renumber() {
  await ensureLoaded();
  await modal("Renumerar frames", async (ctx, doc) => {
    S.frames.forEach((f, i) => {
      const l = findLayer(doc, f.id);
      if (l) l.name = makeName(frameLabel(i + 1), f.hold, f.mark);
    });
    await loadFrames(doc);
  });
  render();
}

async function toggleOnion(force) {
  const o = S.settings.onion;
  o.enabled = typeof force === "boolean" ? force : !o.enabled;
  saveSettings();
  syncControls();
  await reapplyOnion(!o.enabled);
}

async function reapplyOnion(clean = false) {
  if (!activeDoc() || !S.groupId || !S.frames.length) return;
  await modal("Casca de cebola", async (ctx, doc) => {
    if (clean || !S.settings.onion.tint) await cleanOnion(doc);
    await applyView(doc);
  });
  render();
}

async function createGroup() {
  const doc = activeDoc();
  if (!doc) throw new Error("Abra um documento primeiro.");
  const n = S.groups.length + 1;
  await modal("Criar grupo de animação", async (ctx, d) => {
    const group = await d.createLayerGroup({ name: `${ANIM_PREFIX} Animação ${n}` });
    const layer = await d.createLayer({ name: makeName(frameLabel(1), S.settings.defaultHold) });
    await layer.move(group, constants.ElementPlacement.PLACEINSIDE);
    S.groupId = group.id;
    S.groupByDoc[d.id] = group.id;
    await loadFrames(d);
    S.current = 0;
    await applyView(d);
  });
  render();
  queueThumbs();
  openRename();
}

async function useSelection() {
  const doc = activeDoc();
  if (!doc) throw new Error("Abra um documento primeiro.");
  const act = Array.from(doc.activeLayers || []);
  if (!act.length) throw new Error("Selecione um grupo ou as camadas dos frames no painel Camadas.");
  await modal("Usar seleção como animação", async (ctx, d) => {
    let group;
    if (act.length === 1 && isGroup(act[0])) {
      group = act[0];
    } else {
      group = await d.groupLayers(act);
    }
    if (!group.name.trim().toUpperCase().startsWith(ANIM_PREFIX)) {
      group.name = `${ANIM_PREFIX} ${group.name}`;
    }
    S.groupId = group.id;
    S.groupByDoc[d.id] = group.id;
    S.frames = [];
    await loadFrames(d);
    S.current = 0;
    await applyView(d);
  });
  render();
  queueThumbs();
  status(`Animação com ${S.frames.length} frame(s).`);
}

// ---------------------------------------------------------------- play

// ---------------------------------------------------------------- play / flip / exportar

// Monta o "tocador": para cada tempo t, quais camadas ficam visíveis
function makePlayer(doc, { pose = false } = {}) {
  const curMap = pose ? poseMap(S.frames) : ticksOf(S.frames);
  const others = S.settings.syncGroups
    ? otherGroupsData(doc).map((o) => ({ frames: o.frames, map: ticksOf(o.frames) }))
    : [];
  let total = curMap.length;
  for (const o of others) total = Math.max(total, o.map.length);
  return {
    total,
    at(t) {
      const ci = curMap[Math.min(t, curMap.length - 1)];
      const ids = [S.frames[ci].id];
      for (const o of others) {
        const f = frameAtTick(o.frames, o.map, t);
        if (f) ids.push(f.id);
      }
      return { ids, curIndex: ci };
    },
  };
}

function swapCmds(prevIds, nextIds) {
  const prev = new Set(prevIds || []);
  const next = new Set(nextIds);
  const cmds = [];
  for (const id of next) if (!prev.has(id)) cmds.push({ _obj: "show", null: [{ _ref: "layer", _id: id }] });
  for (const id of prev) if (!next.has(id)) cmds.push({ _obj: "hide", null: [{ _ref: "layer", _id: id }] });
  return cmds;
}

// Troca as camadas visíveis: uma operação curtinha por troca,
// para o Photoshop redesenhar a tela entre uma e outra.
async function swapVisible(prevIds, nextIds) {
  const cmds = swapCmds(prevIds, nextIds);
  if (!cmds.length) return;
  await core.executeAsModal(async () => bp(cmds), { commandName: tr("Pegbar: flip") });
}

// Deixa os frames "limpos" (100%, sem cor), sem mesa de luz,
// e só as camadas de `ids` visíveis. A cebola volta depois com applyView.
async function flatten(doc, ids) {
  const keep = new Set(ids);
  const groups = [findLayer(doc, S.groupId)];
  if (S.settings.syncGroups || S.settings.lightTable) {
    for (const o of otherGroupsData(doc)) groups.push(o.group);
  }
  for (const g of groups) {
    if (!g) continue;
    if (!g.visible) g.visible = true;
    if (Math.round(g.opacity) !== 100) g.opacity = 100;
    const isCur = g.id === S.groupId;
    for (const l of Array.from(g.layers)) {
      if (!isCur && !S.settings.syncGroups) continue;
      if (S.tintKey.has(l.id)) await clearTint(l.id);
      const vis = keep.has(l.id);
      if (l.visible !== vis) l.visible = vis;
      if (Math.round(l.opacity) !== 100) l.opacity = 100;
    }
  }
}

function tickSequence(total) {
  const base = [];
  for (let t = 0; t < total; t++) base.push(t);
  if (S.settings.playMode === "pingpong" && total > 2) {
    for (let t = total - 2; t > 0; t--) base.push(t);
  }
  return base;
}

// Play no canvas do arquivo, respeitando fps, exposição e o modo (loop, ping-pong, uma vez).
async function togglePlay() {
  if (S.playing) {
    S.stopRequested = true;
    return;
  }
  if (scrub.active) return;
  await ensureLoaded();
  await endShiftTrace();
  if (S.frames.length < 2 && !S.settings.syncGroups) throw new Error("Precisa de pelo menos 2 frames para tocar.");
  const doc = activeDoc();
  const player = makePlayer(doc, { pose: S.settings.poseTest });
  const seq = tickSequence(player.total);
  const startTick = startTickOf(S.frames, S.current);
  let pos = Math.max(0, seq.indexOf(startTick));
  let shown = player.at(seq[pos]);

  S.playing = true;
  S.stopRequested = false;
  renderPlayButton();
  try {
    await modal("Play", async (ctx, d) => flatten(d, shown.ids));
    S.busy = true;
    status(S.settings.poseTest ? "Teste de poses: só chaves e extremos." : "Tocando no canvas. Stop, espaço ou Esc param.");
    const frameMs = 1000 / clamp(S.settings.fps, 1, 60);
    const t0 = Date.now();
    const startPos = pos;
    while (!S.stopRequested) {
      const elapsed = Math.floor((Date.now() - t0) / frameMs);
      let p = startPos + elapsed;
      if (p >= seq.length) {
        if (S.settings.playMode === "once") break;
        p %= seq.length;
      }
      const next = player.at(seq[p]);
      if (next.ids.join() !== shown.ids.join()) {
        await swapVisible(shown.ids, next.ids);
        shown = next;
        highlightPlaying(next.curIndex);
      }
      await sleep(Math.max(1, t0 + (elapsed + 1) * frameMs - Date.now()));
    }
  } finally {
    S.playing = false;
    S.busy = false;
    S.stopRequested = false;
    renderPlayButton();
    S.current = shown.curIndex;
    try {
      await modal(`Frame ${S.current + 1}`, async (ctx, d) => applyView(d));
    } catch (e) {
      console.warn(e);
    }
    render();
    status("");
  }
}

// ---------------------------------------------------------------- flip por botões

// Folheia como papel: os anteriores até o atual, o atual até os seguintes (e volta), ou ao redor.
async function flipRoll(mode) {
  if (S.playing) {
    S.stopRequested = true;
    return;
  }
  if (scrub.active) return;
  await ensureLoaded();
  await endShiftTrace();
  const n = S.frames.length;
  if (n < 2) throw new Error("Precisa de pelo menos 2 frames para flipar.");
  const k = clamp(S.settings.flipCount, 1, 24);
  const cur = S.current;
  const lo = Math.max(0, cur - k);
  const hi = Math.min(n - 1, cur + k);
  const seq = [];
  if (mode === "before") {
    for (let i = lo; i <= cur; i++) seq.push(i);
  } else if (mode === "after") {
    for (let i = cur; i <= hi; i++) seq.push(i);
    for (let i = hi - 1; i >= cur; i--) seq.push(i);
  } else {
    for (let i = lo; i <= hi; i++) seq.push(i);
    for (let i = hi - 1; i >= cur; i--) seq.push(i);
  }
  const doc = activeDoc();
  const player = makePlayer(doc);
  const idsOf = (i) => player.at(startTickOf(S.frames, i)).ids;
  let shown = idsOf(seq[0]);
  S.playing = true;
  S.stopRequested = false;
  renderPlayButton();
  try {
    await modal("Flip", async (ctx, d) => flatten(d, shown));
    S.busy = true;
    highlightPlaying(seq[0]);
    const ms = 1000 / clamp(S.settings.fps, 1, 60);
    for (const i of seq) {
      if (S.stopRequested) break;
      const ids = idsOf(i);
      await swapVisible(shown, ids);
      shown = ids;
      highlightPlaying(i);
      await sleep(ms * Math.max(1, S.frames[i].hold));
    }
  } finally {
    S.playing = false;
    S.busy = false;
    S.stopRequested = false;
    renderPlayButton();
    try {
      await modal(`Frame ${cur + 1}`, async (ctx, d) => applyView(d));
    } catch (e) {
      console.warn(e);
    }
    render();
  }
}

// ---------------------------------------------------------------- flip (arrastar para folhear)

const scrub = {
  active: false,
  ready: null,
  player: null,
  shownIds: [],
  shown: -1,
  target: -1,
  running: false,
  moved: false,
  startX: 0,
};

function scrubIds(i) {
  return scrub.player.at(startTickOf(S.frames, i)).ids;
}

async function scrubStart() {
  if (S.playing || scrub.active) return false;
  if (!S.frames.length) return false;
  scrub.active = true;
  scrub.shown = S.current;
  scrub.target = S.current;
  scrub.ready = (async () => {
    await endShiftTrace();
    const doc = activeDoc();
    scrub.player = makePlayer(doc);
    scrub.shownIds = scrubIds(S.current);
    await modal("Flip", async (ctx, d) => flatten(d, scrub.shownIds));
  })().catch((e) => console.warn(e));
  return true;
}

function scrubTo(i) {
  if (!scrub.active) return;
  i = clamp(i, 0, S.frames.length - 1);
  if (i === scrub.target) return;
  scrub.target = i;
  highlightPlaying(i);
  setFlipKnob(i);
  if (document.activeElement !== $("holdValue")) $("holdValue").value = S.frames[i] ? S.frames[i].hold : 1;
  scrubPump();
}

async function scrubPump() {
  if (scrub.running) return;
  scrub.running = true;
  try {
    await scrub.ready;
    S.busy = true;
    while (scrub.target !== scrub.shown) {
      const t = scrub.target;
      const ids = scrubIds(t);
      try {
        await swapVisible(scrub.shownIds, ids);
        scrub.shownIds = ids;
        scrub.shown = t;
      } catch (e) {
        await sleep(15);
      }
    }
  } finally {
    scrub.running = false;
  }
}

async function scrubEnd() {
  if (!scrub.active) return;
  await scrub.ready;
  while (scrub.running) await sleep(10);
  await scrubPump();
  scrub.active = false;
  S.busy = false;
  S.current = scrub.shown;
  S.selected.clear();
  try {
    await modal(`Frame ${S.current + 1}`, async (ctx, doc) => applyView(doc));
  } catch (e) {
    console.warn(e);
  }
  render();
}

function cellIndexAt(e) {
  let el = e.target;
  while (el && el !== document && !(el.classList && el.classList.contains("cell"))) el = el.parentNode;
  if (!el || !el.getAttribute) return -1;
  if (parseInt(el.getAttribute("data-row"), 10) !== S.groupId) return -1;
  const i = parseInt(el.getAttribute("data-i"), 10);
  return isNaN(i) ? -1 : i;
}

// Posição do botão da barra de flip
function setFlipKnob(i) {
  const knob = $("flipKnob");
  const n = S.frames.length;
  if (knob) knob.style.left = (n > 1 ? (clamp(i, 0, n - 1) / (n - 1)) * 100 : 0) + "%";
  const v = $("flipValue");
  if (v) v.textContent = n ? `${clamp(i, 0, n - 1) + 1} / ${n}` : "";
}

// Flip arrastando: na barra FLIP ou na régua de tempo da timeline (como no TVPaint)
function bindFlip() {
  const bar = $("flipBar");
  const ruler = $("ruler");
  const track = $("track");
  let mode = null; // "bar" | "ruler"

  const fromBar = (e) => {
    const r = bar.getBoundingClientRect();
    const u = clamp((e.clientX - r.left) / Math.max(1, r.width), 0, 1);
    return Math.round(u * Math.max(0, S.frames.length - 1));
  };
  const fromRuler = (e) => {
    const r = ruler.getBoundingClientRect();
    const t = Math.floor((e.clientX - r.left - HEAD_W) / Math.max(1, S.settings.slotW));
    const map = ticksOf(S.frames);
    if (!map.length) return 0;
    return map[clamp(t, 0, map.length - 1)];
  };
  const start = (e, m) => {
    if (S.playing || !S.frames.length || S.cutMode) return;
    mode = m;
    hideTip();
    scrubStart();
    scrubTo(m === "bar" ? fromBar(e) : fromRuler(e));
  };
  bar.addEventListener("mousedown", (e) => start(e, "bar"));
  ruler.addEventListener("mousedown", (e) => start(e, "ruler"));
  document.addEventListener("mousemove", (e) => {
    if (!mode || !scrub.active) return;
    scrubTo(mode === "bar" ? fromBar(e) : fromRuler(e));
  });
  document.addEventListener("mouseup", () => {
    if (!mode) return;
    mode = null;
    safe(scrubEnd);
  });

  bindDragDrop(track);
  bindResize(track);
}

// ---------------------------------------------------------------- esticar / encurtar a exposição na timeline

const resize = { active: false, pending: false, rowId: null, i: -1, id: null, startX: 0, startHold: 1, hold: 1, el: null };

function bindResize(track) {
  track.addEventListener("mousedown", (e) => {
    const g = e.target;
    if (!g || !g.getAttribute || !g.getAttribute("data-grip")) return;
    let el = g;
    while (el && !(el.classList && el.classList.contains("cell"))) el = el.parentNode;
    if (!el) return;
    const rowId = parseInt(el.getAttribute("data-row"), 10);
    const i = parseInt(el.getAttribute("data-i"), 10);
    const row = S.rows.find((r) => r.id === rowId) || { frames: S.frames };
    const f = row.frames[i];
    if (!f) return;
    e.stopPropagation();
    resize.active = true;
    resize.rowId = rowId;
    resize.i = i;
    resize.id = f.id;
    resize.startX = e.clientX;
    resize.startHold = f.hold;
    resize.hold = f.hold;
    resize.el = el;
    scrub.moved = true; // não dispara o clique de "ir para o frame"
    hideTip();
  });
  document.addEventListener("mousemove", (e) => {
    if (!resize.active) return;
    const slot = Math.max(1, S.settings.slotW);
    const h = Math.max(1, resize.startHold + Math.round((e.clientX - resize.startX) / slot));
    if (h === resize.hold) return;
    resize.hold = h;
    resize.el.style.width = h * slot - 2 + "px";
    const th = resize.el.querySelector(".thumb");
    if (th) th.style.width = h * slot - 2 + "px";
    const lab = resize.el.querySelector(".hold");
    if (lab) lab.textContent = "x" + h;
    status(`x${resize.startHold} → x${h}`);
  });
  document.addEventListener("mouseup", () => {
    if (!resize.active) return;
    resize.active = false;
    if (resize.hold !== resize.startHold) safe(() => setHoldById(resize.rowId, resize.id, resize.hold));
    else render();
  });
}

// Muda a exposição de um desenho de qualquer linha
async function setHoldById(rowId, id, hold) {
  await ensureLoaded();
  hold = clamp(hold, 1, 999);
  await modal(`Exposição x${hold}`, async (ctx, doc) => {
    const l = findLayer(doc, id);
    if (!l) return;
    const p = parseName(l.name);
    l.name = makeName(p.base, hold, p.mark);
    await loadFrames(doc);
    if (rowId !== S.groupId) await settleGroup(doc, rowId, startTickOf(S.frames, S.current));
    else await applyView(doc, { select: false });
  });
  render();
}

function highlightPlaying(fi) {
  const cells = document.querySelectorAll("#track .row.active .cell");
  cells.forEach((c) => {
    const i = parseInt(c.getAttribute("data-i"), 10);
    if (i === fi) c.classList.add("playing");
    else c.classList.remove("playing");
  });
}


// ---------------------------------------------------------------- ferramentas: pivô, girar, espelhar

// Pivô (anchor point) por camada, guardado por documento.
// pivots[docTitle][layerId] = {x, y} em pixels do documento.
const PIVOTS_KEY = "pegbarPivots";
let pivotStore = (() => {
  try {
    return JSON.parse(localStorage.getItem(PIVOTS_KEY) || "{}");
  } catch (e) {
    return {};
  }
})();
let pivotGuides = []; // guias que o plugin criou para marcar o pivô
const viewFlip = {}; // docId -> {h, v}

function savePivots() {
  try {
    localStorage.setItem(PIVOTS_KEY, JSON.stringify(pivotStore));
  } catch (e) {
    /* ignora */
  }
}

function docKey(doc) {
  try {
    return doc.title || String(doc.id);
  } catch (e) {
    return String(doc.id);
  }
}

function activeLayersOf(doc) {
  return Array.from(doc.activeLayers || []).filter((l) => !!l);
}

function layerBounds(l) {
  const b = l.boundsNoEffects || l.bounds;
  return { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
}

function centerOf(b) {
  return { x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 };
}

function storedPivot(doc, layer) {
  const d = pivotStore[docKey(doc)];
  return d && d[layer.id] ? d[layer.id] : null;
}

// Pivô efetivo: o guardado, ou o centro da camada
function getPivot(doc, layer) {
  return storedPivot(doc, layer) || centerOf(layerBounds(layer));
}

function setPivotFor(doc, layers, pt) {
  const k = docKey(doc);
  pivotStore[k] = pivotStore[k] || {};
  for (const l of layers) pivotStore[k][l.id] = { x: Math.round(pt.x), y: Math.round(pt.y) };
  savePivots();
}

async function selectionBounds(doc) {
  try {
    const b = doc.selection && doc.selection.bounds;
    if (b && b.right > b.left) return { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
  } catch (e) {
    /* tenta pelo batchPlay */
  }
  try {
    const res = await bp({
      _obj: "get",
      _target: [{ _property: "selection" }, { _ref: "document", _id: doc.id }],
    });
    const sel = res && res[0] && res[0].selection;
    if (sel && sel.right) {
      const v = (o) => (typeof o === "object" ? o._value : o);
      return { left: v(sel.left), top: v(sel.top), right: v(sel.right), bottom: v(sel.bottom) };
    }
  } catch (e) {
    /* sem seleção */
  }
  return null;
}

async function deselectAll(d) {
  try {
    await d.selection.deselect();
  } catch (e) {
    await bp({ _obj: "set", _target: [{ _ref: "channel", _property: "selection" }], to: { _enum: "ordinal", _value: "none" } });
  }
}

async function clearPivotGuides(doc) {
  for (const g of pivotGuides) {
    try {
      await g.delete();
    } catch (e) {
      /* a guia já pode ter sido apagada */
    }
  }
  pivotGuides = [];
}

async function drawPivotGuides(doc, pt) {
  await clearPivotGuides(doc);
  if (!S.settings.showPivot || !pt) return;
  try {
    pivotGuides.push(await doc.guides.add(constants.Direction.VERTICAL, Math.round(pt.x)));
    pivotGuides.push(await doc.guides.add(constants.Direction.HORIZONTAL, Math.round(pt.y)));
  } catch (e) {
    console.warn("não consegui desenhar as guias do pivô", e);
  }
}

function needLayers(doc) {
  const layers = activeLayersOf(doc);
  if (!layers.length) throw new Error("Selecione a camada (ou as camadas) no painel Camadas.");
  return layers;
}

// Define o pivô: "selection" (centro da seleção), um dos 9 pontos, ou {x,y}
async function setPivot(mode) {
  const doc = activeDoc();
  if (!doc) throw new Error("Abra um documento primeiro.");
  let label = "";
  await modal("Definir pivô", async (ctx, d) => {
    const layers = needLayers(d);
    let pt;
    const selB = await selectionBounds(d);
    if (mode === "selection") {
      if (!selB) throw new Error("Faça uma seleção pequena (ou um clique com o Laço) onde quer o pivô, e clique de novo.");
      pt = centerOf(selB);
      if (selB.right - selB.left <= 24 && selB.bottom - selB.top <= 24) {
        // seleção minúscula = só marca o ponto do pivô
        await deselectAll(d);
        label = "ponto marcado";
      } else {
        label = "centro da seleção";
      }
    } else if (typeof mode === "object") {
      pt = mode;
      label = "posição digitada";
    } else {
      // 9 pontos: do objeto selecionado (seleção) ou da camada
      const b = selB || layerBounds(layers[0]);
      const [row, col] = mode.split("");
      const xs = { l: b.left, c: (b.left + b.right) / 2, r: b.right };
      const ys = { t: b.top, m: (b.top + b.bottom) / 2, b: b.bottom };
      pt = { x: xs[col], y: ys[row] };
      label = selB ? "ponto da seleção" : "ponto da camada";
    }
    setPivotFor(d, layers, pt);
    await drawPivotGuides(d, pt);
  });
  renderPivot();
  status(`Pivô definido (${label}).`);
}

async function resetPivot() {
  const doc = activeDoc();
  if (!doc) return;
  await modal("Pivô no centro", async (ctx, d) => {
    const layers = needLayers(d);
    const k = docKey(d);
    if (pivotStore[k]) for (const l of layers) delete pivotStore[k][l.id];
    savePivots();
    await drawPivotGuides(d, getPivot(d, layers[0]));
  });
  renderPivot();
}

// Gira e/ou escala as camadas selecionadas mantendo o pivô parado.
// Matemática: transforma no centro da camada (c) e depois desloca por (p - c) - M(p - c).
// Comando de transformação do Photoshop com o ponto de referência no pivô
// (igual a arrastar o ponto de referência no Ctrl+T). Age nas camadas selecionadas.
function pivotTransformCmd(p, { angle = 0, w = 100, h = 100 } = {}) {
  return {
    _obj: "transform",
    _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
    freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSIndependent" },
    position: {
      _obj: "paint",
      horizontal: { _unit: "pixelsUnit", _value: p.x },
      vertical: { _unit: "pixelsUnit", _value: p.y },
    },
    offset: {
      _obj: "offset",
      horizontal: { _unit: "pixelsUnit", _value: 0 },
      vertical: { _unit: "pixelsUnit", _value: 0 },
    },
    width: { _unit: "percentUnit", _value: w },
    height: { _unit: "percentUnit", _value: h },
    angle: { _unit: "angleUnit", _value: angle },
    interfaceIconFrameDimmed: { _enum: "interpolationType", _value: "bicubic" },
  };
}

// Plano B (se o comando acima falhar): transforma no centro e desloca para o pivô
async function domTransformAtPivot(layers, p, { angle = 0, w = 100, h = 100 }) {
  const th = (angle * Math.PI) / 180;
  const cos = Math.cos(th);
  const sin = Math.sin(th);
  for (const l of layers) {
    const c = centerOf(layerBounds(l));
    if (w !== 100 || h !== 100) await l.scale(Math.abs(w), Math.abs(h), constants.AnchorPosition.MIDDLECENTER);
    if (w < 0) await l.flip("horizontal");
    if (h < 0) await l.flip("vertical");
    if (angle) await l.rotate(angle, constants.AnchorPosition.MIDDLECENTER);
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    const ax = (dx * w) / 100;
    const ay = (dy * h) / 100;
    const tx = dx - (ax * cos - ay * sin);
    const ty = dy - (ax * sin + ay * cos);
    if (Math.abs(tx) > 0.01 || Math.abs(ty) > 0.01) await l.translate(tx, ty);
  }
}

async function moveActiveBy(l, dx, dy) {
  try {
    await selectLayerById(l.id);
    const r = await bp({
      _obj: "move",
      _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
      to: { _obj: "offset", horizontal: { _unit: "pixelsUnit", _value: dx }, vertical: { _unit: "pixelsUnit", _value: dy } },
    });
    if (!bpFailed(r)) return;
  } catch (e) {
    /* plano B abaixo */
  }
  await l.translate(dx, dy);
}

// Transforma UMA camada inteira em volta do ponto p:
// 1) transforma no centro da camada (centro conhecido);
// 2) desloca pela diferença (p - c) - M(p - c);
// 3) mede onde ficou e corrige até bater (no máximo 3 vezes).
async function transformLayerAtPivot(l, p, { angle = 0, w = 100, h = 100 }) {
  const B0 = layerBounds(l);
  if (!(B0.right - B0.left >= 1 && B0.bottom - B0.top >= 1)) return;
  const c = centerOf(B0);
  await selectLayerById(l.id);
  let ok = false;
  try {
    const r = await bp({
      _obj: "transform",
      _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
      freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" },
      offset: { _obj: "offset", horizontal: { _unit: "pixelsUnit", _value: 0 }, vertical: { _unit: "pixelsUnit", _value: 0 } },
      width: { _unit: "percentUnit", _value: w },
      height: { _unit: "percentUnit", _value: h },
      angle: { _unit: "angleUnit", _value: angle },
      interfaceIconFrameDimmed: { _enum: "interpolationType", _value: "bicubic" },
    });
    ok = !bpFailed(r);
  } catch (e) {
    ok = false;
  }
  if (!ok) {
    if (w !== 100 || h !== 100) await l.scale(Math.abs(w), Math.abs(h), constants.AnchorPosition.MIDDLECENTER);
    if (w < 0) await l.flip("horizontal");
    if (h < 0) await l.flip("vertical");
    if (angle) await l.rotate(angle, constants.AnchorPosition.MIDDLECENTER);
  }
  const th = (angle * Math.PI) / 180;
  const cos = Math.cos(th);
  const sin = Math.sin(th);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  const ax = (dx * w) / 100;
  const ay = (dy * h) / 100;
  const tx = dx - (ax * cos - ay * sin);
  const ty = dy - (ax * sin + ay * cos);
  const c1 = centerOf(layerBounds(l));
  const target = { x: c1.x + tx, y: c1.y + ty };
  // desloca, mede quanto andou de verdade e compensa (se o Photoshop andar diferente do pedido)
  let fx = 1;
  let fy = 1;
  for (let k = 0; k < 6; k++) {
    const cur = centerOf(layerBounds(l));
    const ex = target.x - cur.x;
    const ey = target.y - cur.y;
    if (Math.abs(ex) < 0.75 && Math.abs(ey) < 0.75) break;
    const rx = ex / fx;
    const ry = ey / fy;
    await moveActiveBy(l, rx, ry);
    const after = centerOf(layerBounds(l));
    const mx = after.x - cur.x;
    const my = after.y - cur.y;
    if (Math.abs(rx) > 2 && Math.abs(mx) > 0.5) fx = clamp(mx / rx, 0.05, 20);
    if (Math.abs(ry) > 2 && Math.abs(my) > 0.5) fy = clamp(my / ry, 0.05, 20);
  }
}

async function runPivotTransform(name, opts) {
  const doc = activeDoc();
  if (!doc) throw new Error("Abra um documento primeiro.");
  await modal(name, async (ctx, d) => {
    const layers = needLayers(d);
    const p = getPivot(d, layers[0]);
    const selB = await selectionBounds(d);
    if (selB) {
      // objeto selecionado: separa os pixels numa camada temporária, transforma e junta de volta
      const src = layers[0];
      await selectLayerById(src.id);
      let tmp = null;
      try {
        await bp({ _obj: "cutToLayer" });
        tmp = Array.from(d.activeLayers || [])[0];
      } catch (e) {
        tmp = null;
      }
      if (!tmp || tmp.id === src.id) throw new Error("A seleção está vazia nesta camada.");
      await transformLayerAtPivot(tmp, p, opts);
      // a seleção acompanha o objeto (para girar de novo)
      try {
        await bp({
          _obj: "set",
          _target: [{ _ref: "channel", _property: "selection" }],
          to: { _ref: "channel", _enum: "channel", _value: "transparencyEnum" },
        });
      } catch (e) {
        /* sem seleção nova */
      }
      await selectLayerById(tmp.id);
      await bp({ _obj: "mergeLayersNew" }); // junta com a camada de baixo (a original)
      await loadFrames(d);
    } else {
      for (const l of layers) await transformLayerAtPivot(l, p, opts);
      if (layers.length > 1) {
        await bp(layers.map((l, i) => ({
          _obj: "select",
          _target: [{ _ref: "layer", _id: l.id }],
          selectionModifier: i ? { _enum: "selectionModifierType", _value: "addToSelection" } : undefined,
          makeVisible: false,
        })));
      }
    }
    await drawPivotGuides(d, p);
  });
  queueThumbs(S.frames[S.current] ? [S.frames[S.current].id] : []);
}

async function transformAtPivot({ angle = 0, sx = 100, sy = 100, name = "Transformar no pivô" }) {
  await runPivotTransform(name, { angle, w: sx, h: sy });
}

// Espelha o objeto (camadas selecionadas) usando o pivô como eixo
async function flipObject(axis) {
  await runPivotTransform(axis === "horizontal" ? "Espelhar objeto (horizontal)" : "Espelhar objeto (vertical)", {
    w: axis === "horizontal" ? -100 : 100,
    h: axis === "vertical" ? -100 : 100,
  });
}

// Abre o Ctrl+T do Photoshop já com o ponto de referência no pivô: gire e escale à mão
async function freeTransformAtPivot() {
  const doc = activeDoc();
  if (!doc) throw new Error("Abra um documento primeiro.");
  const layers = needLayers(doc);
  const p = getPivot(doc, layers[0]);
  status("Gire/escale à mão. Enter confirma, Esc cancela.");
  S.busy = true;
  try {
    await core.executeAsModal(
      async () => {
        const cmd = pivotTransformCmd(p);
        cmd._options = { dialogOptions: "display" };
        await action.batchPlay([cmd], {});
      },
      { commandName: tr("Transformar à mão no pivô"), interactive: true }
    );
  } finally {
    S.busy = false;
    S.quietUntil = Date.now() + 600;
  }
  queueThumbs(S.frames[S.current] ? [S.frames[S.current].id] : []);
  status("");
}

// Espelha a tela inteira para conferir o desenho (aperte de novo para voltar)
async function flipView(axis) {
  const doc = activeDoc();
  if (!doc) throw new Error("Abra um documento primeiro.");
  const st = (viewFlip[doc.id] = viewFlip[doc.id] || { h: false, v: false });
  const key = axis === "horizontal" ? "h" : "v";
  await modal(axis === "horizontal" ? "Ver espelhado" : "Ver de cabeça para baixo", async (ctx, d) => {
    await clearPivotGuides(d);
    await bp({
      _obj: "flip",
      _target: [{ _ref: "document", _enum: "ordinal", _value: "targetEnum" }],
      axis: { _enum: "orientation", _value: axis },
    });
  });
  st[key] = !st[key];
  // os pivôs guardados também espelham, para continuarem no mesmo lugar do desenho
  const k = docKey(doc);
  if (pivotStore[k]) {
    for (const id of Object.keys(pivotStore[k])) {
      const pt = pivotStore[k][id];
      if (axis === "horizontal") pt.x = doc.width - pt.x;
      else pt.y = doc.height - pt.y;
    }
    savePivots();
  }
  renderPivot();
  queueThumbs(S.frames.map((f) => f.id));
  status(
    st.h || st.v
      ? "Tela espelhada. Aperte o mesmo botão de novo para voltar ao normal."
      : "Tela de volta ao normal."
  );
}

// Seleciona o pincel; a simetria nativa do Photoshop fica no ícone de borboleta
async function brushSymmetry() {
  await modal(
    "Pincel com simetria",
    async () => {
      await bp({ _obj: "select", _target: [{ _ref: "paintbrushTool" }] });
    },
    { history: false }
  );
  status("Pincel ativo. Clique na BORBOLETA na barra de opções (lá em cima) e escolha Vertical, Horizontal ou outra simetria.");
}

function renderPivot() {
  const doc = activeDoc();
  const el = $("pivotInfo");
  if (!el) return;
  if (!doc) {
    el.textContent = "";
    return;
  }
  const l = Array.from(doc.activeLayers || [])[0];
  if (!l) {
    el.textContent = tr("selecione uma camada");
    return;
  }
  let pt;
  try {
    pt = storedPivot(doc, l);
  } catch (e) {
    pt = null;
  }
  if (pt) {
    $("pivotX").value = pt.x;
    $("pivotY").value = pt.y;
    el.textContent = "";
  } else {
    $("pivotX").value = "";
    $("pivotY").value = "";
    el.textContent = tr("(centro)");
  }
  const st = viewFlip[doc.id] || {};
  setOn($("btnViewH"), !!st.h);
  setOn($("btnViewV"), !!st.v);
}

function setOn(el, on) {
  if (!el) return;
  if (on) el.classList.add("on");
  else el.classList.remove("on");
}

function renderToolsToggle() {
  const open = S.settings.toolsOpen;
  setOn($("btnTools"), open);
  renderTabs();
}


// ---------------------------------------------------------------- marcas de chave / extremo / intervalo

async function setMark(mark) {
  await ensureLoaded();
  const ids = targetIds();
  if (!ids.length) return;
  const label = { K: "chave", B: "extremo", I: "intervalo", "": "sem marca" }[mark];
  await modal(`Marcar como ${label}`, async (ctx, doc) => {
    for (const id of ids) {
      const f = S.frames.find((x) => x.id === id);
      const l = findLayer(doc, id);
      if (f && l) l.name = makeName(f.base, f.hold, mark);
    }
    await loadFrames(doc);
    if (S.settings.onion.keysOnly) await applyView(doc, { select: false });
  });
  render();
}

// ---------------------------------------------------------------- shift & trace

// Cria uma cópia temporária do desenho anterior (ou seguinte) para você
// mover, girar e espelhar à vontade, alinhando com o desenho atual.
// O desenho original não é tocado; "Terminar" apaga a cópia.
const st = { active: false, copyId: null, srcId: null, docId: null };

async function startShiftTrace(dir) {
  await ensureLoaded();
  await endShiftTrace();
  // procura o vizinho que aparece na cebola (respeita "só chaves")
  let idx = -1;
  for (let i = S.current + dir; i >= 0 && i < S.frames.length; i += dir) {
    const d = onionDist(i);
    if (d !== null && d !== 0) {
      idx = i;
      break;
    }
  }
  if (idx < 0) throw new Error(dir < 0 ? "Não há desenho anterior." : "Não há desenho seguinte.");
  const o = S.settings.onion;
  const color = dir < 0 ? o.colorBefore : o.colorAfter;
  await modal("Shift & Trace", async (ctx, doc) => {
    const group = findLayer(doc, S.groupId);
    const src = findLayer(doc, S.frames[idx].id);
    if (S.tintKey.has(src.id)) await clearTint(src.id);
    const copy = await src.duplicate();
    copy.name = `[S&T] ${src.name}`;
    await copy.move(group, constants.ElementPlacement.PLACEBEFORE); // fora do grupo, por cima
    copy.visible = true;
    copy.opacity = Math.max(25, o.opacity);
    src.visible = false;
    await setTint(copy.id, color);
    await selectLayerById(copy.id);
    st.active = true;
    st.copyId = copy.id;
    st.srcId = src.id;
    st.docId = doc.id;
  });
  renderShiftTrace();
  status("Shift & Trace: mova com a ferramenta Mover (V), Ctrl+T, as setas ou os botões de girar/espelhar no pivô. Depois clique em Terminar.");
}

async function endShiftTrace() {
  if (!st.active) return;
  const doc = activeDoc();
  st.active = false;
  try {
    if (doc && doc.id === st.docId) {
      await modal("Terminar Shift & Trace", async (ctx, d) => {
        const copy = findLayer(d, st.copyId);
        if (copy) await copy.delete();
        S.tintKey.delete(st.copyId);
        await loadFrames(d);
        await applyView(d);
      });
    }
  } finally {
    st.copyId = null;
    st.srcId = null;
    renderShiftTrace();
    render();
  }
}

async function nudgeShiftTrace(dx, dy) {
  if (!st.active) throw new Error("Ligue o Shift & Trace primeiro.");
  await modal("Mover cópia", async (ctx, d) => {
    const copy = findLayer(d, st.copyId);
    if (copy) await copy.translate(dx * S.settings.stStep, dy * S.settings.stStep);
  });
}

function renderShiftTrace() {
  const el = $("stState");
  if (!el) return;
  el.textContent = st.active ? tr("ligado") : "";
  setOn($("btnStPrev"), st.active);
  setOn($("btnStNext"), st.active);
}

// ---------------------------------------------------------------- ciclos

// Repete os frames selecionados (ou todos) N vezes. Modos: ciclo, ping-pong ou aleatório.
async function repeatCycle(mode) {
  await ensureLoaded();
  const ids = S.selected.size > 1 ? targetIds() : S.frames.map((f) => f.id);
  const n = clamp(S.settings.repeatCount, 1, 20);
  if (ids.length < 2) throw new Error("Selecione pelo menos 2 frames (ou deixe sem seleção para usar todos).");
  let order = [];
  for (let r = 0; r < n; r++) {
    if (mode === "pingpong") {
      // A B C D -> + C B (A B C D C B …): volta sem repetir as pontas
      const back = ids.slice(1, -1).reverse();
      order = order.concat(back, r < n - 1 ? ids : []);
    } else if (mode === "random") {
      const pool = ids.slice();
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      order = order.concat(pool);
    } else {
      order = order.concat(ids);
    }
  }
  const lastId = ids[ids.length - 1];
  let made = 0;
  await modal(`Repetir ciclo (${order.length} frames)`, async (ctx, doc) => {
    let anchor = findLayer(doc, lastId);
    let num = nextFrameNumber();
    for (const id of order) {
      const src = findLayer(doc, id);
      if (!src) continue;
      if (S.tintKey.has(src.id)) await clearTint(src.id);
      const dup = await src.duplicate();
      const p = parseName(src.name);
      dup.name = makeName(frameLabel(num++), p.hold, p.mark);
      await dup.move(anchor, constants.ElementPlacement.PLACEBEFORE);
      anchor = dup;
      made++;
    }
    await loadFrames(doc);
    S.selected.clear();
    await applyView(doc);
  });
  render();
  queueThumbs();
  status(`${made} frame(s) adicionados ao ciclo.`);
}

// ---------------------------------------------------------------- guias de enquadramento

let fieldGuides = [];

const FIELD_ASPECTS = { "16:9": 16 / 9, "9:16": 9 / 16, "1:1": 1, "4:5": 4 / 5 };

async function drawFieldGuides(mode) {
  const doc = activeDoc();
  if (!doc) throw new Error("Abra um documento primeiro.");
  await modal(
    "Guias de enquadramento",
    async (ctx, d) => {
      for (const g of fieldGuides) {
        try {
          await g.delete();
        } catch (e) {
          /* já apagada */
        }
      }
      fieldGuides = [];
      if (mode === "none") return;
      const W = d.width;
      const H = d.height;
      let w = W;
      let h = H;
      if (FIELD_ASPECTS[mode]) {
        const a = FIELD_ASPECTS[mode];
        if (W / H > a) {
          h = H;
          w = H * a;
        } else {
          w = W;
          h = W / a;
        }
      }
      const x0 = (W - w) / 2;
      const y0 = (H - h) / 2;
      const add = async (dir, c) => {
        if (c <= 0.5 || c >= (dir === "v" ? W : H) - 0.5) return; // não marca a borda do documento
        const g = await d.guides.add(
          dir === "v" ? constants.Direction.VERTICAL : constants.Direction.HORIZONTAL,
          Math.round(c)
        );
        fieldGuides.push(g);
      };
      // borda do formato + área de ação (93%) + área de título (90%)
      for (const k of [1, 0.93, 0.9]) {
        const mx = (w * (1 - k)) / 2;
        const my = (h * (1 - k)) / 2;
        await add("v", x0 + mx);
        await add("v", x0 + w - mx);
        await add("h", y0 + my);
        await add("h", y0 + h - my);
      }
    },
    { history: false }
  );
  status(mode === "none" ? "Guias de enquadramento removidas." : `Guias ${mode === "doc" ? "do documento" : mode}: borda, área de ação (93%) e área de título (90%).`);
}

// ---------------------------------------------------------------- gráfico de timing

function easeFn(kind) {
  if (kind === "in") return (u) => u * u; // devagar no início
  if (kind === "out") return (u) => 1 - (1 - u) * (1 - u); // devagar no fim
  if (kind === "inout") return (u) => u * u * (3 - 2 * u);
  return (u) => u;
}

// Posições dos traços: 0 e L são as chaves, o resto são os intervalos
function timingPositions(n, kind, L) {
  const f = easeFn(kind);
  const out = [];
  for (let i = 0; i <= n + 1; i++) out.push(Math.round(f(i / (n + 1)) * L));
  return out;
}

async function drawTimingChart() {
  await ensureLoaded();
  const stg = S.settings;
  const n = clamp(stg.tcCount, 1, 30);
  const L = clamp(stg.tcLength, 40, 4000);
  const vertical = stg.tcOrient === "vertical";
  const pos = timingPositions(n, stg.tcEase, L);
  const thick = 2;
  const keyHalf = 14;
  const inbHalf = 8;
  const across = keyHalf * 2 + 4;
  const w = vertical ? across : L + 4;
  const h = vertical ? L + 4 : across;
  const buf = new Uint8Array(w * h * 4);
  const color = [200, 40, 40, 255];
  const plot = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (y * w + x) * 4;
    buf[i] = color[0];
    buf[i + 1] = color[1];
    buf[i + 2] = color[2];
    buf[i + 3] = color[3];
  };
  const mid = Math.floor(across / 2);
  // linha principal
  for (let a = 0; a <= L; a++) {
    for (let t = 0; t < thick; t++) {
      if (vertical) plot(mid - 1 + t, a + 2);
      else plot(a + 2, mid - 1 + t);
    }
  }
  // traços
  pos.forEach((p, i) => {
    const half = i === 0 || i === pos.length - 1 ? keyHalf : inbHalf;
    for (let b = -half; b <= half; b++) {
      for (let t = 0; t < thick; t++) {
        if (vertical) plot(mid + b, p + 2 - 1 + t);
        else plot(p + 2 - 1 + t, mid + b);
      }
    }
  });

  await modal("Gráfico de timing", async (ctx, doc) => {
    const group = findLayer(doc, S.groupId);
    const ref = activeLayersOf(doc)[0];
    const p = ref ? getPivot(doc, ref) : { x: doc.width / 2, y: doc.height / 2 };
    const layer = await doc.createLayer({ name: `[GUIA] Timing ${n} int. (${stg.tcEase})` });
    await layer.move(group, constants.ElementPlacement.PLACEBEFORE);
    const left = clamp(Math.round(p.x - w / 2), 0, Math.max(0, doc.width - w));
    const top = clamp(Math.round(p.y - h / 2), 0, Math.max(0, doc.height - h));
    const img = await imaging.createImageDataFromBuffer(buf, {
      width: w,
      height: h,
      components: 4,
      chunky: true,
      colorProfile: "sRGB IEC61966-2.1",
      colorSpace: "RGB",
    });
    try {
      await imaging.putPixels({ documentID: doc.id, layerID: layer.id, imageData: img, targetBounds: { left, top } });
    } finally {
      img.dispose();
    }
    if (S.frames[S.current]) await selectLayerById(S.frames[S.current].id);
  });
  status("Gráfico de timing criado numa camada [GUIA] acima da animação (no pivô da camada selecionada).");
}

// ---------------------------------------------------------------- exportar sequência PNG

function safeFileName(name) {
  return (
    groupDisplayName(name)
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "") || "animacao"
  );
}

async function exportPNGSequence() {
  await ensureLoaded();
  await endShiftTrace();
  const fs = storage.localFileSystem;
  const folder = await fs.getFolder();
  if (!folder) return;
  const doc = activeDoc();
  const g = S.groups.find((x) => x.id === S.groupId);
  const base = safeFileName(g ? g.name : "animacao");
  const player = makePlayer(doc);
  const ticks = S.settings.exportOnePerDrawing
    ? S.frames.map((f, i) => startTickOf(S.frames, i))
    : Array.from({ length: player.total }, (_, t) => t);
  let written = 0;
  S.busy = true;
  try {
    await core.executeAsModal(
      async (ctx) => {
        // tudo o que muda aqui (visibilidade, cebola) é descartado no fim
        const sid = await ctx.hostControl.suspendHistory({ documentID: doc.id, name: tr("Exportar PNG") });
        try {
          let shown = player.at(ticks[0]).ids;
          await flatten(doc, shown);
          let lastFile = null;
          let lastKey = null;
          for (let k = 0; k < ticks.length; k++) {
            if (ctx.isCancelled) break;
            const next = player.at(ticks[k]).ids;
            const cmds = swapCmds(shown, next);
            if (cmds.length) await bp(cmds);
            shown = next;
            const key = next.join(",");
            const file = await folder.createFile(`${base}_${String(k + 1).padStart(4, "0")}.png`, { overwrite: true });
            if (key === lastKey && lastFile) {
              // mesma imagem (exposição): copia o arquivo em vez de salvar de novo
              const data = await lastFile.read({ format: storage.formats.binary });
              await file.write(data, { format: storage.formats.binary });
            } else {
              await doc.saveAs.png(file, { compression: 6 }, true);
              lastFile = file;
              lastKey = key;
            }
            written++;
            try {
              ctx.reportProgress({ value: (k + 1) / ticks.length, commandName: tr(`Exportando ${k + 1}/${ticks.length}`) });
            } catch (e) {
              /* versões sem barra de progresso */
            }
          }
        } finally {
          await ctx.hostControl.resumeHistory(sid, false);
        }
      },
      { commandName: tr("Pegbar: exportar sequência PNG") }
    );
  } finally {
    S.busy = false;
    S.quietUntil = Date.now() + 600;
  }
  render();
  status(`${written} PNG salvos (${base}_0001.png…). Importe a sequência no editor de vídeo a ${S.settings.fps} fps.`);
}


// ---------------------------------------------------------------- GIF animado (codificador próprio)

// Reduz a imagem a 256 cores (agrupa cores parecidas; ótimo para desenho com poucas cores)
function quantize256(rgb) {
  const n = rgb.length / 3;
  const cnt = new Uint32Array(32768);
  const sr = new Float64Array(32768);
  const sg = new Float64Array(32768);
  const sb = new Float64Array(32768);
  const keys = new Uint16Array(n);
  for (let i = 0; i < n; i++) {
    const r = rgb[i * 3];
    const g = rgb[i * 3 + 1];
    const b = rgb[i * 3 + 2];
    const k = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    keys[i] = k;
    cnt[k]++;
    sr[k] += r;
    sg[k] += g;
    sb[k] += b;
  }
  const used = [];
  for (let k = 0; k < 32768; k++) if (cnt[k]) used.push(k);
  used.sort((a, b) => cnt[b] - cnt[a]);
  const pal = used.slice(0, 256).map((k) => [Math.round(sr[k] / cnt[k]), Math.round(sg[k] / cnt[k]), Math.round(sb[k] / cnt[k])]);
  const map = new Int16Array(32768).fill(-1);
  pal.forEach((c, i) => (map[used[i]] = i));
  for (let u = 256; u < used.length; u++) {
    const k = used[u];
    const r = sr[k] / cnt[k];
    const g = sg[k] / cnt[k];
    const b = sb[k] / cnt[k];
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < pal.length; i++) {
      const d = (pal[i][0] - r) ** 2 + (pal[i][1] - g) ** 2 + (pal[i][2] - b) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    map[k] = best;
  }
  const idx = new Uint8Array(n);
  for (let i = 0; i < n; i++) idx[i] = map[keys[i]];
  while (pal.length < 256) pal.push([0, 0, 0]);
  return { pal, idx };
}

// LZW do GIF (mesmo algoritmo do omggif)
function gifLZW(idx, minCode) {
  const out = [];
  const clear = 1 << minCode;
  const eoi = clear + 1;
  let next = eoi + 1;
  let size = minCode + 1;
  let cur = 0;
  let shift = 0;
  let table = new Map();
  const emit = (c) => {
    cur |= c << shift;
    shift += size;
    while (shift >= 8) {
      out.push(cur & 0xff);
      cur >>>= 8;
      shift -= 8;
    }
  };
  emit(clear);
  let ib = idx[0];
  for (let i = 1; i < idx.length; i++) {
    const k = idx[i];
    const key = (ib << 8) | k;
    const v = table.get(key);
    if (v !== undefined) {
      ib = v;
      continue;
    }
    emit(ib);
    if (next === 4096) {
      emit(clear);
      next = eoi + 1;
      size = minCode + 1;
      table = new Map();
    } else {
      if (next >= 1 << size) size++;
      table.set(key, next++);
    }
    ib = k;
  }
  emit(ib);
  emit(eoi);
  if (shift > 0) out.push(cur & 0xff);
  return out;
}

function encodeGIF(frames, w, h) {
  const bytes = [];
  const u16 = (v) => bytes.push(v & 0xff, (v >> 8) & 0xff);
  const str = (t) => {
    for (let i = 0; i < t.length; i++) bytes.push(t.charCodeAt(i));
  };
  str("GIF89a");
  u16(w);
  u16(h);
  bytes.push(0, 0, 0); // sem paleta global
  // repetir sempre
  bytes.push(0x21, 0xff, 0x0b);
  str("NETSCAPE2.0");
  bytes.push(3, 1, 0, 0, 0);
  for (const f of frames) {
    const { pal, idx } = quantize256(f.rgb);
    bytes.push(0x21, 0xf9, 4, 0x04);
    u16(clamp(f.delay, 2, 65535));
    bytes.push(0, 0);
    bytes.push(0x2c);
    u16(0);
    u16(0);
    u16(w);
    u16(h);
    bytes.push(0x87); // paleta local de 256 cores
    for (const c of pal) bytes.push(c[0], c[1], c[2]);
    bytes.push(8);
    const data = gifLZW(idx, 8);
    for (let i = 0; i < data.length; i += 255) {
      const chunk = data.slice(i, i + 255);
      bytes.push(chunk.length);
      for (const b of chunk) bytes.push(b);
    }
    bytes.push(0);
  }
  bytes.push(0x3b);
  return new Uint8Array(bytes);
}

// Imagem composta do documento (o que está visível), já em RGB sobre branco e no tamanho W x H
async function compositeRGB(doc, W, H) {
  let res;
  try {
    res = await imaging.getPixels({ documentID: doc.id, targetSize: { width: W, height: H }, componentSize: 8, colorSpace: "RGB" });
  } catch (e) {
    res = await imaging.getPixels({ documentID: doc.id, targetSize: { width: W, height: H } });
  }
  const img = res.imageData;
  try {
    const data = await img.getData({ chunky: true });
    const iw = img.width;
    const ih = img.height;
    const c = img.components || Math.round(data.length / (iw * ih));
    const out = new Uint8Array(W * H * 3);
    for (let y = 0; y < H; y++) {
      const sy = Math.min(ih - 1, Math.floor((y * ih) / H));
      for (let x = 0; x < W; x++) {
        const sx = Math.min(iw - 1, Math.floor((x * iw) / W));
        const si = (sy * iw + sx) * c;
        const di = (y * W + x) * 3;
        if (c >= 4) {
          const a = data[si + 3] / 255;
          out[di] = data[si] * a + 255 * (1 - a);
          out[di + 1] = data[si + 1] * a + 255 * (1 - a);
          out[di + 2] = data[si + 2] * a + 255 * (1 - a);
        } else if (c === 3) {
          out[di] = data[si];
          out[di + 1] = data[si + 1];
          out[di + 2] = data[si + 2];
        } else {
          out[di] = out[di + 1] = out[di + 2] = data[si];
        }
      }
    }
    return out;
  } finally {
    try {
      img.dispose();
    } catch (e) {
      /* ignora */
    }
  }
}

async function exportGIF() {
  await ensureLoaded();
  await endShiftTrace();
  const folder = await storage.localFileSystem.getFolder();
  if (!folder) return;
  const doc = activeDoc();
  const g = S.groups.find((x) => x.id === S.groupId);
  const base = safeFileName(g ? g.name : "animacao");
  const player = makePlayer(doc);
  const k = clamp(S.settings.gifScale, 10, 100) / 100;
  const W = Math.max(1, Math.round(num(doc.width) * k));
  const H = Math.max(1, Math.round(num(doc.height) * k));
  // um quadro do GIF por desenho, com a duração da exposição
  const segs = [];
  let last = null;
  for (let t = 0; t < player.total; t++) {
    const key = player.at(t).ids.join();
    if (key === last) segs[segs.length - 1].n++;
    else {
      segs.push({ t, n: 1 });
      last = key;
    }
  }
  const fps = clamp(S.settings.fps, 1, 60);
  const frames = [];
  S.busy = true;
  try {
    await core.executeAsModal(
      async (ctx) => {
        const sid = await ctx.hostControl.suspendHistory({ documentID: doc.id, name: "GIF" });
        try {
          let shown = player.at(segs[0].t).ids;
          await flatten(doc, shown);
          for (let i = 0; i < segs.length; i++) {
            if (ctx.isCancelled) break;
            const next = player.at(segs[i].t).ids;
            const cmds = swapCmds(shown, next);
            if (cmds.length) await bp(cmds);
            shown = next;
            frames.push({ rgb: await compositeRGB(doc, W, H), delay: Math.round((segs[i].n * 100) / fps) });
            try {
              ctx.reportProgress({ value: (i + 1) / segs.length, commandName: tr(`Exportando ${i + 1}/${segs.length}`) });
            } catch (e) {
              /* sem barra */
            }
          }
        } finally {
          await ctx.hostControl.resumeHistory(sid, false);
        }
      },
      { commandName: tr("Pegbar: exportar GIF") }
    );
  } finally {
    S.busy = false;
    S.quietUntil = Date.now() + 600;
  }
  const bytes = encodeGIF(frames, W, H);
  const file = await folder.createFile(`${base}.gif`, { overwrite: true });
  await file.write(bytes.buffer, { format: storage.formats.binary });
  render();
  status(`GIF salvo: ${base}.gif (${W}x${H}, ${frames.length} desenhos).`);
}

function showMP4Help() {
  const box = $("diagBox");
  if (!box) return;
  box.style.display = "flex";
  $("diagImg").style.display = "none";
  $("diagText").textContent = tr(
    "Para virar MP4 no Photoshop:\n1. Arquivo > Abrir e escolha o primeiro PNG exportado (…_0001.png).\n2. Marque \"Sequência de imagens\" e clique em Abrir; informe o mesmo fps.\n3. Arquivo > Exportar > Renderizar vídeo… > formato H.264 (MP4) > Renderizar."
  );
}

async function exportSelected() {
  const fmt = S.settings.exportFormat || "png";
  if (fmt === "gif") return exportGIF();
  await exportPNGSequence();
  if (fmt === "mp4") showMP4Help();
}

// ---------------------------------------------------------------- desfazer / refazer e "Sobre"

const PEGBAR_VERSION = "1.0.0";

function pluginVersion() {
  try {
    const v = require("uxp").versions && require("uxp").versions.plugin;
    if (v) return v;
  } catch (e) {
    /* usa a constante */
  }
  return PEGBAR_VERSION;
}

// Volta ou avança um passo no histórico do Photoshop (como Ctrl+Z / Ctrl+Shift+Z)
async function historyStep(dir) {
  const doc = activeDoc();
  if (!doc) throw new Error("Abra um documento primeiro.");
  await endShiftTrace();
  try {
    await modal(
      dir < 0 ? "Desfazer" : "Refazer",
      async () => {
        await bp({ _obj: "select", _target: [{ _ref: "historyState", _enum: "ordinal", _value: dir < 0 ? "previous" : "next" }] });
      },
      { history: false }
    );
  } catch (e) {
    throw new Error(dir < 0 ? "Não há o que desfazer." : "Não há o que refazer.");
  }
  S.thumbs.clear();
  await refresh({ followActive: true });
}

function openLink(url) {
  try {
    require("uxp").shell.openExternal(url);
  } catch (e) {
    status(url);
  }
}

function showAbout() {
  const box = $("aboutBox");
  if (!box) return;
  $("aboutVersion").textContent = tr("Versão {0}").replace("{0}", pluginVersion());
  box.style.display = "flex";
}
// ---------------------------------------------------------------- abas de ferramentas

const TOOL_TABS = ["pivot", "anim", "groups", "guides", "export"];

function renderTabs() {
  const tab = TOOL_TABS.includes(S.settings.toolsTab) ? S.settings.toolsTab : "pivot";
  for (const t of TOOL_TABS) {
    const pane = $("tab-" + t);
    if (pane) pane.style.display = S.settings.toolsOpen && t === tab ? "flex" : "none";
    setOn($("tabBtn-" + t), t === tab);
  }
  const row = $("tabRow");
  if (row) row.style.display = S.settings.toolsOpen ? "flex" : "none";
}
// ---------------------------------------------------------------- interface

// ---- ícones: versão clara (tema escuro) ou escura (tema claro)
let lightTheme = false;
function detectTheme() {
  try {
    const t = document.theme && document.theme.getCurrent && document.theme.getCurrent();
    lightTheme = t === "light" || t === "lightest";
  } catch (e) {
    lightTheme = false;
  }
}
function iconSrc(name) {
  return `icons/ui/${name}${lightTheme ? "-l" : ""}.png`;
}
function applyIcons(root) {
  (root || document).querySelectorAll("img[data-icon]").forEach((img) => {
    img.src = iconSrc(img.getAttribute("data-icon"));
  });
}

// ---- dica: ao passar o mouse, a descrição do botão aparece na barra de status
let hintShown = false;
// Etiqueta flutuante: o painel do Photoshop não mostra o "title", então o plugin desenha a sua
let tipTimer = null;
let tipEl = null;
function hideTip() {
  clearTimeout(tipTimer);
  const t = $("tip");
  if (t) t.style.display = "none";
  tipEl = null;
}
function showTip(el) {
  const t = $("tip");
  const app = $("app");
  if (!t || !el || !el.getAttribute) return;
  const text = el.getAttribute("title");
  if (!text) return;
  t.textContent = text;
  t.style.display = "block";
  const r = el.getBoundingClientRect();
  const W = (app && app.clientWidth) || document.body.clientWidth || 800;
  const H = document.body.clientHeight || 400;
  const tw = t.offsetWidth || 180;
  const tH = t.offsetHeight || 22;
  let x = r.left + r.width / 2 - tw / 2;
  x = Math.max(4, Math.min(x, W - tw - 4));
  let y = r.bottom + 6;
  if (y + tH > H - 2) y = r.top - tH - 6;
  t.style.left = Math.round(x) + "px";
  t.style.top = Math.round(Math.max(2, y)) + "px";
}

function bindHints() {
  document.addEventListener("mousedown", hideTip);
  document.addEventListener("mouseover", (e) => {
    let tel = e.target;
    while (tel && tel !== document && !(tel.getAttribute && tel.getAttribute("title"))) tel = tel.parentNode;
    if (!tel || !tel.getAttribute) {
      hideTip();
    } else if (tel !== tipEl) {
      hideTip();
      tipEl = tel;
      tipTimer = setTimeout(() => showTip(tel), 450);
    }
  });
  document.addEventListener("mouseover", (e) => {
    let el = e.target;
    while (el && el !== document && !(el.getAttribute && el.getAttribute("title"))) el = el.parentNode;
    const st = $("status");
    if (!st) return;
    if (el && el.getAttribute) {
      if (st.className === "error") return; // não cobre mensagens de erro
      st.textContent = el.getAttribute("title");
      st.className = "hintTxt";
      hintShown = true;
    } else if (hintShown) {
      st.textContent = "";
      st.className = "";
      hintShown = false;
    }
  });
}

function renderPlayButton() {
  const b = $("btnPlay");
  if (!b) return;
  const img = b.querySelector("img");
  if (img) {
    img.setAttribute("data-icon", S.playing ? "stop" : "play");
    img.src = iconSrc(S.playing ? "stop" : "play");
  }
  if (S.playing) b.classList.add("playing");
  else b.classList.remove("playing");
}

function syncControls() {
  const st = S.settings;
  const o = st.onion;
  $("fps").value = st.fps;
  $("defaultHold").value = st.defaultHold;
  $("rotStep").value = st.rotStep;
  $("scaleStep").value = st.scaleStep;
  $("showPivot").checked = st.showPivot;
  renderToolsToggle();
  $("playMode").value = st.playMode;
  $("thumbH").value = st.thumbH;
  $("flipCount").value = st.flipCount;
  $("showAllRows").checked = st.showAllRows;
  $("thumbFit").checked = st.thumbFit !== "page";
  $("onionKeysOnly").checked = o.keysOnly;
  $("poseTest").checked = st.poseTest;
  $("stStep").value = st.stStep;
  $("repeatCount").value = st.repeatCount;
  $("syncGroups").checked = st.syncGroups;
  $("lightTable").checked = st.lightTable;
  $("lightOpacity").value = st.lightOpacity;
  $("lightOpacityVal").textContent = st.lightOpacity + "%";
  $("fieldGuide").value = st.fieldGuide;
  $("tcCount").value = st.tcCount;
  $("tcEase").value = st.tcEase;
  $("tcOrient").value = st.tcOrient;
  $("tcLength").value = st.tcLength;
  $("exportOnePer").checked = st.exportOnePerDrawing;
  $("exportFormat").value = st.exportFormat || "png";
  $("gifScale").value = st.gifScale;
  $("gifOpts").style.display = st.exportFormat === "gif" ? "flex" : "none";
  $("pngOpts").style.display = st.exportFormat === "gif" ? "none" : "flex";
  $("zoom").value = st.slotW;
  $("onionOn").checked = o.enabled;
  $("onionBefore").value = o.before;
  $("onionAfter").value = o.after;
  $("onionOpacity").value = o.opacity;
  $("onionOpacityVal").textContent = o.opacity + "%";
  $("onionTint").checked = o.tint;
  $("onionFalloff").checked = o.falloff;
  renderSwatches();
}

function renderSwatches() {
  const o = S.settings.onion;
  const mk = (which) =>
    Object.keys(ONION_CSS)
      .map(
        (k) =>
          `<span class="swatch ${o[which] === k ? "active" : ""}" title="${tr(which === "colorBefore" ? "Cor da cebola antes" : "Cor da cebola depois")}" data-onion="${which}" data-color="${k}" style="background-color:${ONION_CSS[k]}"></span>`
      )
      .join("");
  $("swBefore").innerHTML = mk("colorBefore");
  $("swAfter").innerHTML = mk("colorAfter");
  $("groupLabels").innerHTML = LABELS.map(
    (l) =>
      `<span class="swatch" title="${tr("Grupo: " + l.name)}" data-grouplabel="${l.key}" style="background-color:${l.css}"></span>`
  ).join("");
  $("labels").innerHTML = LABELS.map(
    (l) =>
      `<span class="swatch" title="${tr(l.name)}" data-label="${l.key}" style="background-color:${l.css}"></span>`
  ).join("");
}

function render() {
  // grupos
  const sel = $("groupSelect");
  if (sel) {
    sel.innerHTML = S.groups.length
      ? S.groups
          .map(
            (g) =>
              `<option value="${g.id}" ${g.id === S.groupId ? "selected" : ""}>${escapeHtml(g.name)}</option>`
          )
          .join("")
      : `<option value="">${tr("(nenhum grupo [ANIM])")}</option>`;
  }

  const cur = S.frames[S.current];
  if (document.activeElement !== $("holdValue")) $("holdValue").value = cur ? cur.hold : 1;
  if (!scrub.active) setFlipKnob(S.current);
  const dot = $("groupDot");
  if (dot) dot.style.backgroundColor = S.groupId && S.groupColor !== "none" ? LABEL_CSS[S.groupColor] || "#9a9a9a" : "transparent";

  renderPivot();
  const ruler = $("ruler");
  const track = $("track");
  if (!activeDoc()) {
    ruler.innerHTML = "";
    track.innerHTML = `<div class="empty">${tr("Abra um documento no Photoshop.")}</div>`;
    return;
  }
  if (!S.groupId) {
    ruler.innerHTML = "";
    track.innerHTML = `<div class="empty">${tr("Nenhuma animação neste documento. Clique em <b>+ Grupo</b> para começar, ou selecione as camadas dos seus desenhos e clique em <b>Usar seleção</b>.")}</div>`;
    return;
  }

  const slotW = S.settings.slotW;
  const th = S.settings.thumbH;
  const o = S.settings.onion;
  const cutSet = new Set(S.clipboard.mode === "cut" ? S.clipboard.ids : []);
  const curTick = startTickOf(S.frames, S.current);
  const rows = S.settings.showAllRows && S.rows.length ? S.rows : [{ id: S.groupId, name: (S.groups.find((g) => g.id === S.groupId) || {}).name || "", color: S.groupColor, frames: S.frames, active: true }];

  // régua (tempo), do tamanho da linha mais longa
  let total = 0;
  for (const r of rows) total = Math.max(total, r.frames.reduce((acc, f) => acc + f.hold, 0));
  let ticks = `<div class="tick head" style="width:${HEAD_W}px"></div>`;
  for (let t = 1; t <= total; t++) {
    const show = slotW >= 24 || t % 5 === 0 || t === 1;
    ticks += `<div class="tick ${t === curTick + 1 ? "cur" : ""}" style="width:${slotW - 1}px">${show ? t : ""}</div>`;
  }

  const cellHtml = (f, i, row) => {
    const w = f.hold * slotW;
    const cls = ["cell"];
    if (row.active) {
      const d = onionDist(i);
      if (d === null) {
        /* fora da cebola */
      } else if (d === 0) cls.push("current");
      else if (o.enabled && d < 0 && -d <= o.before) cls.push("onionBefore");
      else if (o.enabled && d > 0 && d <= o.after) cls.push("onionAfter");
      if (S.selected.has(f.id)) cls.push("selected");
      if (cutSet.has(f.id)) cls.push("cutting");
    } else {
      cls.push("other");
      const st0 = startTickOf(row.frames, i);
      if (curTick >= st0 && curTick < st0 + f.hold) cls.push("attime");
    }
    if (isKeyMark(f.mark)) cls.push("key" + f.mark);
    const thumb = S.thumbs.get(f.id);
    const img = thumb ? `<img src="${thumb}" style="height:${th}px">` : "";
    const tag = f.color === "none" ? "transparent" : LABEL_CSS[f.color] || "#9a9a9a";
    const mk = f.mark ? ` <span class="mk ${f.mark}">${f.mark}</span>` : "";
    return `<div class="${cls.join(" ")}" data-row="${row.id}" data-i="${i}" style="width:${w - 2}px" title="${escapeHtml(f.name)}">
        <div class="tag" style="background-color:${tag}"></div>
        <div class="thumb" style="height:${th}px;width:${w - 2}px">${img}</div>
        <div class="info"><span>${i + 1}${mk}</span><span class="hold">${f.hold > 1 ? "x" + f.hold : ""}</span></div>
        <div class="grip" data-grip="1" title="${tr("Arraste para esticar ou encurtar a exposição")}"></div>
      </div>`;
  };

  let html = "";
  for (const r of rows) {
    const dot = r.color && r.color !== "none" ? LABEL_CSS[r.color] || "#9a9a9a" : "transparent";
    const cells = r.frames.map((f, i) => cellHtml(f, i, r)).join("");
    html += `<div class="row ${r.active ? "active" : ""}" data-rowid="${r.id}">
        <div class="rowHead" data-rowhead="${r.id}" style="width:${HEAD_W - 6}px" title="${tr("Clique para editar este grupo")}">
          <span class="dot" style="background-color:${dot}"></span>
          <span class="rowName">${escapeHtml(groupDisplayName(r.name))}</span>
          ${r.active ? `<span class="rowEdit">${tr("editando")}</span>` : ""}
        </div>
        <div class="rowCells">${cells || `<div class="empty small">${tr("vazio — clique em Novo")}</div>`}</div>
      </div>`;
  }
  ruler.innerHTML = ticks;
  track.innerHTML = html;

  // rola até o frame atual
  const curEl = track.querySelector(".row.active .cell.current");
  const wrap = $("timelineWrap");
  if (curEl && wrap) {
    const x = curEl.offsetLeft;
    if (x < wrap.scrollLeft + HEAD_W || x + curEl.offsetWidth > wrap.scrollLeft + wrap.clientWidth) {
      wrap.scrollLeft = Math.max(0, x - HEAD_W - 40);
    }
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---- corte (navalha): divide uma exposição no quadro clicado, como na edição de vídeo
function cutPoint(el, e) {
  const rowId = parseInt(el.getAttribute("data-row"), 10);
  const i = parseInt(el.getAttribute("data-i"), 10);
  const row = S.rows.find((r) => r.id === rowId) || { id: S.groupId, frames: S.frames };
  const f = row.frames[i];
  if (!f) return null;
  const r = el.getBoundingClientRect();
  const k = Math.round((e.clientX - r.left) / Math.max(1, S.settings.slotW));
  return { rowId, i, f, k: clamp(k, 1, Math.max(1, f.hold - 1)) };
}

function showCutLine(el, e) {
  document.querySelectorAll("#track .cutLine").forEach((x) => x.parentNode && x.parentNode.removeChild(x));
  if (!S.cutMode || !el) return;
  const cp = cutPoint(el, e);
  if (!cp || cp.f.hold < 2) return;
  const line = document.createElement("div");
  line.className = "cutLine";
  line.style.left = cp.k * S.settings.slotW - 2 + "px";
  el.appendChild(line);
}

function toggleCutMode(force) {
  S.cutMode = typeof force === "boolean" ? force : !S.cutMode;
  setOn($("btnRazor"), S.cutMode);
  const tr0 = $("track");
  if (tr0) {
    if (S.cutMode) tr0.classList.add("cutMode");
    else tr0.classList.remove("cutMode");
  }
  if (!S.cutMode) document.querySelectorAll("#track .cutLine").forEach((x) => x.parentNode && x.parentNode.removeChild(x));
  status(S.cutMode ? "Corte ligado: clique dentro de uma exposição para dividir (Shift + clique corta e tira o resto). Esc desliga." : "");
}

async function cutExposure(rowId, i, k, trim) {
  const row = S.rows.find((r) => r.id === rowId) || { id: S.groupId, frames: S.frames };
  const f = row.frames[i];
  if (!f) return;
  if (f.hold < 2) throw new Error("Este desenho está em x1: não há exposição para cortar.");
  k = clamp(k, 1, f.hold - 1);
  const rest = f.hold - k;
  let newId = null;
  await modal(trim ? "Cortar exposição" : "Dividir exposição", async (ctx, doc) => {
    const l = findLayer(doc, f.id);
    if (!l) return;
    if (S.tintKey.has(f.id)) await clearTint(f.id);
    if (!trim) {
      const dup = await l.duplicate();
      dup.name = makeName(frameLabel(nextFrameNumber()), rest, "");
      await dup.move(l, constants.ElementPlacement.PLACEBEFORE); // logo depois, na timeline
      newId = dup.id;
    }
    l.name = makeName(f.base, k, f.mark);
    await loadFrames(doc);
    if (rowId !== S.groupId) {
      await settleGroup(doc, rowId, startTickOf(S.frames, S.current));
    } else {
      S.selected = newId ? new Set([newId]) : new Set();
      await applyView(doc);
    }
  });
  render();
  queueThumbs();
  status(trim ? `Exposição cortada: x${f.hold} → x${k}.` : `Dividido em x${k} + x${rest}. A parte da direita ficou selecionada: aperte Delete para tirá-la.`);
}

function onCellClick(e) {
  if (S.cutMode) {
    let el = e.target;
    while (el && el !== document && !(el.classList && el.classList.contains("cell"))) el = el.parentNode;
    if (!el || !el.getAttribute) return;
    const cp = cutPoint(el, e);
    if (cp) safe(() => cutExposure(cp.rowId, cp.i, cp.k, !!e.shiftKey));
    return;
  }
  if (scrub.moved) {
    scrub.moved = false;
    return;
  }
  let el = e.target;
  while (el && el !== document && !(el.getAttribute && (el.getAttribute("data-rowhead") || (el.classList && el.classList.contains("cell"))))) el = el.parentNode;
  if (!el || !el.getAttribute) return;
  // clique no nome do grupo: passa a editar esse grupo
  const head = el.getAttribute("data-rowhead");
  if (head) {
    safe(() => switchGroup(parseInt(head, 10)));
    return;
  }
  const rowId = parseInt(el.getAttribute("data-row"), 10);
  const i = parseInt(el.getAttribute("data-i"), 10);
  if (isNaN(i)) return;
  if (rowId !== S.groupId) {
    safe(() => switchGroup(rowId, i));
    return;
  }
  const f = S.frames[i];
  if (e.shiftKey && S.anchor !== null) {
    const [a, b] = [Math.min(S.anchor, i), Math.max(S.anchor, i)];
    S.selected = new Set(S.frames.slice(a, b + 1).map((x) => x.id));
    render();
    return;
  }
  if (e.ctrlKey || e.metaKey) {
    if (S.selected.has(f.id)) S.selected.delete(f.id);
    else S.selected.add(f.id);
    S.anchor = i;
    render();
    return;
  }
  S.selected.clear();
  S.anchor = i;
  safe(() => goTo(i));
}

function setZoom(dir) {
  const st = S.settings;
  st.slotW = clamp(st.slotW + dir * 8, 16, 120);
  st.thumbH = clamp(st.thumbH + dir * 10, 20, 140);
  saveSettings();
  syncControls();
  render();
}

function bindUI() {
  const on = (id, fn) => {
    const el = $(id);
    if (el) el.addEventListener("click", () => safe(fn));
  };
  on("btnCreateGroup", createGroup);
  on("btnUseSelected", useSelection);
  on("btnRefresh", async () => {
    S.thumbs.clear();
    S.previews.clear();
    await refresh({ followActive: true });
  });
  on("btnFirst", async () => {
    await ensureLoaded();
    S.selected.clear();
    await goTo(0);
  });
  on("btnPrev", () => step(-1));
  on("btnPlay", togglePlay);
  on("btnNext", () => step(1));
  on("btnLast", async () => {
    await ensureLoaded();
    S.selected.clear();
    await goTo(S.frames.length - 1);
  });
  on("btnNew", () => newFrame(false));
  on("btnDup", () => newFrame(true));
  on("btnDelete", deleteFrames);
  on("btnMoveL", () => moveFrames(-1));
  on("btnMoveR", () => moveFrames(1));
  on("btnCut", () => copyFrames("cut"));
  on("btnCopy", () => copyFrames("copy"));
  on("btnPaste", pasteFrames);
  on("btnHoldDown", () => setHold(-1));
  on("btnHoldUp", () => setHold(1));
  on("btnCleanOnion", async () => {
    await ensureLoaded();
    await modal("Limpar cebola", async (ctx, doc) => cleanOnion(doc));
    status("Cebola limpa em todos os frames.");
  });
  on("btnRenumber", renumber);
  on("btnRename", async () => openRename());
  on("btnRenameOk", applyRename);
  on("btnRenameCancel", async () => closeRename());
  on("btnApplyHold", applyDefaultHold);
  on("btnTools", async () => {
    S.settings.toolsOpen = !S.settings.toolsOpen;
    saveSettings();
    renderToolsToggle();
  });
  on("btnPivotSel", () => setPivot("selection"));
  on("btnPivotReset", resetPivot);
  on("btnRotL", () => transformAtPivot({ angle: -S.settings.rotStep, name: "Girar no pivô" }));
  on("btnRotR", () => transformAtPivot({ angle: S.settings.rotStep, name: "Girar no pivô" }));
  on("btnScaleDown", () => {
    const k = 100 - S.settings.scaleStep;
    return transformAtPivot({ sx: k, sy: k, name: "Escalar no pivô" });
  });
  on("btnScaleUp", () => {
    const k = 100 + S.settings.scaleStep;
    return transformAtPivot({ sx: k, sy: k, name: "Escalar no pivô" });
  });
  on("btnFlipObjH", () => flipObject("horizontal"));
  on("btnFlipObjV", () => flipObject("vertical"));
  on("btnViewH", () => flipView("horizontal"));
  on("btnViewV", () => flipView("vertical"));
  on("btnSymmetry", brushSymmetry);
  document.querySelectorAll(".pgrid .pp").forEach((el) =>
    el.addEventListener("click", () => safe(() => setPivot(el.getAttribute("data-p"))))
  );
  const pivotNum = () => {
    const x = parseFloat($("pivotX").value);
    const y = parseFloat($("pivotY").value);
    if (!isNaN(x) && !isNaN(y)) safe(() => setPivot({ x, y }));
  };
  $("pivotX").addEventListener("change", pivotNum);
  $("pivotY").addEventListener("change", pivotNum);
  $("rotStep").addEventListener("change", (e) => {
    S.settings.rotStep = clamp(parseFloat(e.target.value) || 15, 0.1, 180);
    saveSettings();
  });
  $("scaleStep").addEventListener("change", (e) => {
    S.settings.scaleStep = clamp(parseFloat(e.target.value) || 10, 1, 90);
    saveSettings();
  });
  $("showPivot").addEventListener("change", (e) => {
    S.settings.showPivot = !!e.target.checked;
    saveSettings();
    safe(async () => {
      const doc = activeDoc();
      if (!doc) return;
      await modal("Mostrar pivô", async (ctx, d) => {
        const l = Array.from(d.activeLayers || [])[0];
        await drawPivotGuides(d, S.settings.showPivot && l ? getPivot(d, l) : null);
      });
    });
  });
  $("renameInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") safe(applyRename);
    if (e.key === "Escape") closeRename();
  });
  $("defaultHold").addEventListener("change", (e) => {
    S.settings.defaultHold = clamp(parseInt(e.target.value, 10) || 1, 1, 999);
    saveSettings();
    syncControls();
  });

  $("track").addEventListener("click", onCellClick);

  $("groupSelect").addEventListener("change", (e) => {
    const id = parseInt(e.target.value, 10);
    if (id) safe(() => switchGroup(id));
  });

  // etiquetas e cores da cebola
  document.addEventListener("click", (e) => {
    const t = e.target;
    if (!t || !t.getAttribute) return;
    const glabel = t.getAttribute("data-grouplabel");
    if (glabel) {
      safe(() => setGroupColor(glabel));
      return;
    }
    const label = t.getAttribute("data-label");
    if (label) {
      safe(() => setLabel(label));
      return;
    }
    const which = t.getAttribute("data-onion");
    if (which) {
      S.settings.onion[which] = t.getAttribute("data-color");
      saveSettings();
      renderSwatches();
      safe(() => reapplyOnion(false));
    }
  });

  const num = (id, fn) => $(id).addEventListener("change", (e) => fn(e.target.value));
  num("fps", (v) => {
    S.settings.fps = clamp(parseInt(v, 10) || 12, 1, 60);
    saveSettings();
    syncControls();
  });
  $("playMode").addEventListener("change", (e) => {
    S.settings.playMode = e.target.value;
    saveSettings();
  });
  bindNewTools();
  $("thumbH").addEventListener("input", (e) => {
    S.settings.thumbH = parseInt(e.target.value, 10) || 48;
    saveSettings();
    render();
  });
  on("btnZoomOut", async () => setZoom(-1));
  on("btnZoomIn", async () => setZoom(1));
  on("btnFlipBefore", () => flipRoll("before"));
  on("btnFlipAround", () => flipRoll("around"));
  on("btnFlipAfter", () => flipRoll("after"));
  $("flipCount").addEventListener("change", (e) => {
    S.settings.flipCount = clamp(parseInt(e.target.value, 10) || 3, 1, 24);
    saveSettings();
    syncControls();
  });
  $("thumbFit").addEventListener("change", (e) => {
    S.settings.thumbFit = e.target.checked ? "drawing" : "page";
    saveSettings();
    S.thumbs.clear();
    thumbFrames.clear();
    queueThumbs();
  });
  $("showAllRows").addEventListener("change", (e) => {
    S.settings.showAllRows = !!e.target.checked;
    saveSettings();
    render();
    queueThumbs();
  });
  on("btnFreeT", freeTransformAtPivot);
  on("btnRazor", async () => toggleCutMode());
  on("btnUndo", () => historyStep(-1));
  on("btnRedo", () => historyStep(1));
  on("btnAbout", async () => showAbout());
  on("btnAboutClose", async () => {
    $("aboutBox").style.display = "none";
  });
  on("lnkSite", async () => openLink("https://coffeecat.com.br/pegbar"));
  on("lnkCoffee", async () => openLink("https://buymeacoffee.com/studiocoffeecat"));
  $("holdValue").addEventListener("change", (e) => {
    const v = parseInt(e.target.value, 10);
    if (v >= 1) safe(() => setHold(0, clamp(v, 1, 999)));
  });
  on("btnDiag", diagnoseThumbs);
  on("btnDiagClose", async () => {
    $("diagBox").style.display = "none";
    $("diagImg").style.display = "";
  });
  $("track").addEventListener("mousemove", (e) => {
    if (!S.cutMode) return;
    let el = e.target;
    while (el && el !== document && !(el.classList && el.classList.contains("cell"))) el = el.parentNode;
    showCutLine(el && el.getAttribute ? el : null, e);
  });
  $("zoom").addEventListener("input", (e) => {
    S.settings.slotW = parseInt(e.target.value, 10) || 40;
    saveSettings();
    render();
  });
  $("onionOn").addEventListener("change", (e) => safe(() => toggleOnion(!!e.target.checked)));
  num("onionBefore", (v) => {
    S.settings.onion.before = clamp(parseInt(v, 10) || 0, 0, 6);
    saveSettings();
    syncControls();
    safe(() => reapplyOnion(false));
  });
  num("onionAfter", (v) => {
    S.settings.onion.after = clamp(parseInt(v, 10) || 0, 0, 6);
    saveSettings();
    syncControls();
    safe(() => reapplyOnion(false));
  });
  $("onionOpacity").addEventListener("input", (e) => {
    S.settings.onion.opacity = parseInt(e.target.value, 10) || 35;
    $("onionOpacityVal").textContent = S.settings.onion.opacity + "%";
  });
  $("onionOpacity").addEventListener("change", () => {
    saveSettings();
    safe(() => reapplyOnion(false));
  });
  $("onionTint").addEventListener("change", (e) => {
    S.settings.onion.tint = !!e.target.checked;
    saveSettings();
    safe(() => reapplyOnion(!S.settings.onion.tint));
  });
  $("onionFalloff").addEventListener("change", (e) => {
    S.settings.onion.falloff = !!e.target.checked;
    saveSettings();
    safe(() => reapplyOnion(false));
  });

  // atalhos quando o painel está em foco
  document.addEventListener("keydown", (e) => {
    const tag = (e.target && e.target.tagName) || "";
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    const k = e.key;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (k === "x" || k === "X")) return copyFrames("cut");
    if (mod && (k === "c" || k === "C")) return copyFrames("copy");
    if (mod && (k === "v" || k === "V")) return safe(pasteFrames);
    if (k === "ArrowRight" || k === ".") return safe(() => step(1));
    if (k === "ArrowLeft" || k === ",") return safe(() => step(-1));
    if (k === " ") return safe(togglePlay);
    if ((k === "c" || k === "C") && !mod) return toggleCutMode();
    if (k === "Escape" && S.cutMode) return toggleCutMode(false);
    if (k === "Escape" && S.playing) {
      S.stopRequested = true;
      return;
    }
    if (k === "n" || k === "N") return safe(() => newFrame(false));
    if (k === "d" || k === "D") return safe(() => newFrame(true));
    if (k === "+" || k === "=") return safe(() => setHold(1));
    if (k === "-") return safe(() => setHold(-1));
    if (k === "o" || k === "O") return safe(() => toggleOnion());
    if (k === "Delete") return safe(deleteFrames);
  });
}


function bindNewTools() {
  const on = (id, fn) => {
    const el = $(id);
    if (el) el.addEventListener("click", () => safe(fn));
  };
  const setNum = (id, key, min, max, def) =>
    $(id).addEventListener("change", (e) => {
      S.settings[key] = clamp(parseFloat(e.target.value) || def, min, max);
      saveSettings();
      syncControls();
    });

  // abas
  document.querySelectorAll("#tabRow .tab").forEach((el) =>
    el.addEventListener("click", () => {
      S.settings.toolsTab = el.getAttribute("data-tab");
      saveSettings();
      renderTabs();
    })
  );

  // marcas
  on("btnMarkK", () => setMark("K"));
  on("btnMarkB", () => setMark("B"));
  on("btnMarkI", () => setMark("I"));
  on("btnMarkNone", () => setMark(""));
  $("onionKeysOnly").addEventListener("change", (e) => {
    S.settings.onion.keysOnly = !!e.target.checked;
    saveSettings();
    safe(() => reapplyOnion(false));
  });
  $("poseTest").addEventListener("change", (e) => {
    S.settings.poseTest = !!e.target.checked;
    saveSettings();
  });

  // shift & trace
  on("btnStPrev", () => startShiftTrace(-1));
  on("btnStNext", () => startShiftTrace(1));
  on("btnStEnd", endShiftTrace);
  on("btnStL", () => nudgeShiftTrace(-1, 0));
  on("btnStR", () => nudgeShiftTrace(1, 0));
  on("btnStU", () => nudgeShiftTrace(0, -1));
  on("btnStD", () => nudgeShiftTrace(0, 1));
  setNum("stStep", "stStep", 1, 200, 5);

  // ciclos
  setNum("repeatCount", "repeatCount", 1, 20, 2);
  on("btnCycle", () => repeatCycle("loop"));
  on("btnCyclePP", () => repeatCycle("pingpong"));
  on("btnCycleRnd", () => repeatCycle("random"));

  // grupos e mesa de luz
  $("syncGroups").addEventListener("change", (e) => {
    S.settings.syncGroups = !!e.target.checked;
    saveSettings();
    safe(() => reapplyOnion(false));
  });
  $("lightTable").addEventListener("change", (e) => {
    S.settings.lightTable = !!e.target.checked;
    saveSettings();
    safe(() => reapplyOnion(false));
  });
  $("lightOpacity").addEventListener("input", (e) => {
    S.settings.lightOpacity = parseInt(e.target.value, 10) || 30;
    $("lightOpacityVal").textContent = S.settings.lightOpacity + "%";
  });
  $("lightOpacity").addEventListener("change", () => {
    saveSettings();
    if (S.settings.lightTable) safe(() => reapplyOnion(false));
  });

  // guias e timing
  $("fieldGuide").addEventListener("change", (e) => {
    S.settings.fieldGuide = e.target.value;
    saveSettings();
    safe(() => drawFieldGuides(S.settings.fieldGuide));
  });
  setNum("tcCount", "tcCount", 1, 30, 3);
  setNum("tcLength", "tcLength", 40, 4000, 200);
  $("tcEase").addEventListener("change", (e) => {
    S.settings.tcEase = e.target.value;
    saveSettings();
  });
  $("tcOrient").addEventListener("change", (e) => {
    S.settings.tcOrient = e.target.value;
    saveSettings();
  });
  on("btnTiming", drawTimingChart);

  // exportar
  on("btnExportPNG", exportSelected);
  $("exportFormat").addEventListener("change", (e) => {
    S.settings.exportFormat = e.target.value;
    saveSettings();
    syncControls();
  });
  $("gifScale").addEventListener("change", (e) => {
    S.settings.gifScale = clamp(parseInt(e.target.value, 10) || 50, 10, 100);
    saveSettings();
    syncControls();
  });
  $("exportOnePer").addEventListener("change", (e) => {
    S.settings.exportOnePerDrawing = !!e.target.checked;
    saveSettings();
  });
}


// ---------------------------------------------------------------- arrastar e soltar desenhos

const drag = { pending: false, active: false, srcRow: null, srcIds: [], startX: 0, startY: 0, target: null };

function cellOrHeadAt(e) {
  let el = e.target;
  while (el && el !== document && !(el.getAttribute && (el.getAttribute("data-rowhead") || (el.classList && el.classList.contains("cell"))))) el = el.parentNode;
  return el && el.getAttribute ? el : null;
}

function clearDropMarks() {
  document.querySelectorAll("#track .dropBefore, #track .dropAfter, #track .dragging").forEach((c) => {
    c.classList.remove("dropBefore");
    c.classList.remove("dropAfter");
    c.classList.remove("dragging");
  });
}

function bindDragDrop(track) {
  track.addEventListener("mousedown", (e) => {
    if (e.shiftKey || e.ctrlKey || e.metaKey || S.playing || S.cutMode || resize.active) return;
    if (e.target && e.target.getAttribute && e.target.getAttribute("data-grip")) return;
    const el = cellOrHeadAt(e);
    if (!el || !el.classList.contains("cell")) return;
    const rowId = parseInt(el.getAttribute("data-row"), 10);
    const i = parseInt(el.getAttribute("data-i"), 10);
    const row = S.rows.find((r) => r.id === rowId) || { frames: S.frames };
    const f = row.frames[i];
    if (!f) return;
    drag.pending = true;
    drag.active = false;
    drag.srcRow = rowId;
    drag.srcIds = rowId === S.groupId && S.selected.has(f.id) && S.selected.size > 1 ? targetIds() : [f.id];
    drag.startX = e.clientX;
    drag.startY = e.clientY;
    drag.target = null;
  });

  document.addEventListener("mousemove", (e) => {
    if (!drag.pending) return;
    if (!drag.active) {
      if (Math.abs(e.clientX - drag.startX) + Math.abs(e.clientY - drag.startY) < 7) return;
      drag.active = true;
      scrub.moved = true; // evita o clique de "ir para o frame" ao soltar
      document.querySelectorAll("#track .cell").forEach((c) => {
        const r = parseInt(c.getAttribute("data-row"), 10);
        const row = S.rows.find((x) => x.id === r) || { frames: S.frames };
        const f = row.frames[parseInt(c.getAttribute("data-i"), 10)];
        if (f && drag.srcIds.includes(f.id)) c.classList.add("dragging");
      });
      status(e.altKey ? "Copiando: solte onde quer a cópia." : "Movendo: solte entre os desenhos (Alt copia).");
    }
    const el = cellOrHeadAt(e);
    document.querySelectorAll("#track .dropBefore, #track .dropAfter").forEach((c) => {
      c.classList.remove("dropBefore");
      c.classList.remove("dropAfter");
    });
    drag.target = null;
    if (!el) return;
    if (el.getAttribute("data-rowhead")) {
      drag.target = { rowId: parseInt(el.getAttribute("data-rowhead"), 10), index: null, side: "end" };
      return;
    }
    const rect = el.getBoundingClientRect();
    const side = e.clientX < rect.left + rect.width / 2 ? "before" : "after";
    el.classList.add(side === "before" ? "dropBefore" : "dropAfter");
    drag.target = { rowId: parseInt(el.getAttribute("data-row"), 10), index: parseInt(el.getAttribute("data-i"), 10), side };
  });

  document.addEventListener("mouseup", (e) => {
    if (!drag.pending) return;
    const wasActive = drag.active;
    drag.pending = false;
    drag.active = false;
    clearDropMarks();
    if (wasActive && drag.target) {
      const t = drag.target;
      safe(() => dropFrames(drag.srcIds, t.rowId, t.index, t.side, !!e.altKey));
    }
  });
}

// Deixa um grupo que não está sendo editado mostrando só o desenho do tempo atual
async function settleGroup(doc, gid, tick) {
  const g = findLayer(doc, gid);
  if (!g) return;
  const fr = Array.from(g.layers || []).reverse().map((l) => ({ id: l.id, hold: parseName(l.name).hold, layer: l }));
  const keep = frameAtTick(fr, ticksOf(fr), tick);
  for (const f of fr) {
    if (S.tintKey.has(f.id)) await clearTint(f.id);
    if (Math.round(f.layer.opacity) !== 100) f.layer.opacity = 100;
    const vis = !!keep && keep.id === f.id;
    if (f.layer.visible !== vis) f.layer.visible = vis;
  }
}

// Move (ou copia, com Alt) desenhos para antes/depois de outro desenho, em qualquer linha
async function dropFrames(srcIds, rowId, index, side, copy) {
  await ensureLoaded();
  const row = S.rows.find((r) => r.id === rowId) || { id: S.groupId, frames: S.frames };
  const target = index === null ? null : row.frames[index];
  if (target && !copy && srcIds.includes(target.id)) return; // soltou em cima dele mesmo
  const srcRowId = drag.srcRow;
  const srcRow = S.rows.find((r) => r.id === srcRowId) || { frames: S.frames };
  const ordered = srcRow.frames.filter((f) => srcIds.includes(f.id)).map((f) => f.id);
  if (!ordered.length) return;
  const curId = S.frames[S.current] ? S.frames[S.current].id : null;
  const tick = S.frames.length ? startTickOf(S.frames, S.current) : 0;
  let moved = [];
  await modal(copy ? "Copiar desenhos" : "Mover desenhos", async (ctx, doc) => {
    const group = findLayer(doc, rowId);
    let num = nextFrameNumber();
    let prev = null;
    for (const id of ordered) {
      let layer = findLayer(doc, id);
      if (!layer) continue;
      if (S.tintKey.has(id)) await clearTint(id);
      if (copy) {
        const p = parseName(layer.name);
        const dup = await layer.duplicate();
        dup.name = makeName(frameLabel(num++), p.hold, p.mark);
        layer = dup;
      }
      if (!target) {
        // soltou no nome do grupo: vai para o fim da linha
        await layer.move(group, constants.ElementPlacement.PLACEINSIDE);
      } else if (side === "after") {
        await layer.move(prev || findLayer(doc, target.id), constants.ElementPlacement.PLACEBEFORE);
      } else if (!prev) {
        await layer.move(findLayer(doc, target.id), constants.ElementPlacement.PLACEAFTER);
      } else {
        await layer.move(prev, constants.ElementPlacement.PLACEBEFORE);
      }
      prev = layer;
      moved.push(layer.id);
    }
    await loadFrames(doc);
    // grupos que não estão sendo editados mostram só o desenho do tempo atual
    for (const gid of new Set([rowId, srcRowId])) {
      if (gid !== S.groupId) await settleGroup(doc, gid, tick);
    }
    let idx = S.frames.findIndex((f) => f.id === curId);
    if (idx < 0 && rowId === S.groupId) idx = S.frames.findIndex((f) => f.id === moved[moved.length - 1]);
    S.current = clamp(idx < 0 ? S.current : idx, 0, Math.max(0, S.frames.length - 1));
    S.selected.clear();
    if (S.frames.length) await applyView(doc);
  });
  render();
  queueThumbs();
  status(`${moved.length} desenho(s) ${copy ? "copiado(s)" : "movido(s)"}.`);
}
// ---------------------------------------------------------------- eventos do Photoshop

let refreshTimer = null;
function onPsEvent() {
  if (S.busy || S.playing || scrub.active || Date.now() < S.quietUntil) return;
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    if (S.busy || S.playing || scrub.active) return;
    const cur = S.frames[S.current];
    if (cur) {
      S.thumbs.delete(cur.id); // pode ter sido desenhado
      S.previews.delete(cur.id);
    }
    safe(() => refresh({ followActive: true }));
  }, 300);
}

function listenPs() {
  try {
    action.addNotificationListener(
      ["select", "make", "delete", "move", "open", "close", "set", "duplicate", "historyStateChanged", "newDocument"],
      onPsEvent
    );
  } catch (e) {
    console.warn("não consegui ouvir eventos", e);
  }
}

// ---------------------------------------------------------------- entrada

let uiReady = false;
function initUI() {
  if (uiReady) return;
  uiReady = true;
  detectTheme();
  applyIcons();
  collectStatic(document.getElementById("app"));
  LANG = S.settings.lang && S.settings.lang !== "auto" ? S.settings.lang : hostLang();
  $("langSelect").value = LANG;
  $("langSelect").addEventListener("change", (e) => setLanguage(e.target.value));
  applyLanguage();
  translateMenu();
  try {
    document.theme.onUpdated.addListener(() => {
      detectTheme();
      applyIcons();
      renderPlayButton();
    });
  } catch (e) {
    /* versões sem aviso de tema */
  }
  bindHints();
  bindUI();
  bindFlip();
  syncControls();
  renderPlayButton();
  renderShiftTrace();
  listenPs();
}

entrypoints.setup({
  panels: {
    timeline: {
      menuItems: [
        { id: "about", label: "Sobre o Pegbar" },
        { id: "site", label: "Site do Pegbar" },
        { id: "coffee", label: "Me pague um café" },
      ],
      invokeMenu(id) {
        if (id === "about") showAbout();
        else if (id === "site") openLink("https://coffeecat.com.br/pegbar");
        else if (id === "coffee") openLink("https://buymeacoffee.com/studiocoffeecat");
      },
      show() {
        initUI();
        safe(() => refresh({ followActive: true }));
      },
    },
  },
  commands: {
    cmdNext: () => safe(() => step(1)),
    cmdPrev: () => safe(() => step(-1)),
    cmdNew: () => safe(() => newFrame(false)),
    cmdDuplicate: () => safe(() => newFrame(true)),
    cmdOnion: () => safe(() => toggleOnion()),
    cmdPlay: () => safe(togglePlay),
    cmdHoldUp: () => safe(() => setHold(1)),
    cmdHoldDown: () => safe(() => setHold(-1)),
    cmdFlipObjH: () => safe(() => flipObject("horizontal")),
    cmdFlipObjV: () => safe(() => flipObject("vertical")),
    cmdViewFlipH: () => safe(() => flipView("horizontal")),
    cmdViewFlipV: () => safe(() => flipView("vertical")),
    cmdRotL: () => safe(() => transformAtPivot({ angle: -S.settings.rotStep, name: "Girar no pivô" })),
    cmdRazor: () => toggleCutMode(),
    cmdFlipBefore: () => safe(() => flipRoll("before")),
    cmdFlipAround: () => safe(() => flipRoll("around")),
    cmdFlipAfter: () => safe(() => flipRoll("after")),
    cmdFreeT: () => safe(freeTransformAtPivot),
    cmdMarkK: () => safe(() => setMark("K")),
    cmdStPrev: () => safe(() => startShiftTrace(-1)),
    cmdStEnd: () => safe(endShiftTrace),
    cmdRotR: () => safe(() => transformAtPivot({ angle: S.settings.rotStep, name: "Girar no pivô" })),
  },
});

// caso o painel já esteja visível ao carregar
document.addEventListener("DOMContentLoaded", () => {
  initUI();
  safe(() => refresh({ followActive: true }));
});
