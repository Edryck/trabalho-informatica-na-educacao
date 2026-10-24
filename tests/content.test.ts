import { describe, it, expect } from "vitest"
import phasesRaw from "../data/phases.json"
import parts from "../data/parts.json"
import type { PartsCatalog } from "../src/netlist"
import { loadPhases, observationCanRise, type Phase } from "../src/phases"

const catalog = parts as unknown as PartsCatalog
const data = loadPhases(phasesRaw)
const demo = data.groups.filter((g) => g.demo).flatMap((g) => g.phases)

const COVERED_GROUPS: string[] = []
const KEY_PHASES = ["g1p4", "g2p3", "g3p3", "g6p2"]
const LIMITS = { concept: 280, observation: 140, discovery: 140, client: 60, object: 80, thanks: 200 }
const BANNED = [/ótima pergunta/i, /vamos mergulhar/i, /mergulh/i, /jornada/i, /parabéns!/i, /incrível/i, /\p{Extended_Pictographic}/u, /—/]
const PART_ID = /\b[A-Z]{1,3}\d+\b/
const IMPERATIVE = /^(coloca|coloque|põe|ponha|liga|ligue|troca|troque|tira|tire|muda|mude|usa|use|inverte|inverta|move|mova)\b/i
const VERDICT = /\b(defeito|errad[oa]s?|erro|solução|conserta|culpad[oa])\b/i
const HISTORY = /\b(apagou|apagaram|seguiu|saiu|passou a|parou)\b/i

type Field = { field: keyof typeof LIMITS; text: string }

function fields(p: Phase): Field[] {
  const out: Field[] = []
  if (p.lesson) {
    out.push({ field: "concept", text: p.lesson.concept }, { field: "discovery", text: p.lesson.discovery })
    for (const o of p.lesson.observations) out.push({ field: "observation", text: o.say })
  }
  if (p.order) {
    if (p.order.client !== undefined) out.push({ field: "client", text: p.order.client })
    out.push({ field: "object", text: p.order.object }, { field: "thanks", text: p.order.thanks })
  }
  return out
}

function issuesFor(p: Phase): string[] {
  const issues: string[] = []
  for (const { field, text } of fields(p)) {
    const where = `${p.id}.${field}`
    if (typeof text !== "string" || text.trim() === "") {
      issues.push(`${where}: vazio`)
      continue
    }
    if (text.length > LIMITS[field]) issues.push(`${where}: passa de ${LIMITS[field]} caracteres`)
    for (const re of BANNED) if (re.test(text)) issues.push(`${where}: proibido ${re}`)
  }
  if (p.lesson && p.lesson.discovery.trim() !== "") {
    const d = p.lesson.discovery.trim()
    if (!d.endsWith(".") || /[.!?]\s+\S/.test(d)) issues.push(`${p.id}.discovery: precisa ser uma frase só, terminada em ponto`)
  }
  if (p.type !== "tutorial") {
    for (const o of p.lesson?.observations ?? []) {
      if (PART_ID.test(o.say)) issues.push(`${p.id}.observation: cita id de peça`)
      if (IMPERATIVE.test(o.say.trim())) issues.push(`${p.id}.observation: começa mandando fazer`)
      if (VERDICT.test(o.say)) issues.push(`${p.id}.observation: fala em defeito ou solução`)
      if (HISTORY.test(o.say)) issues.push(`${p.id}.observation: conta história em vez de estado`)
    }
  }
  if (p.type === "tutorial" && p.order?.client !== undefined) issues.push(`${p.id}.client: tutorial usa a mentora fixa`)
  return issues
}

function sample(phases: unknown[]): Phase[] {
  return loadPhases({ groups: [{ id: "gx", title: "t", demo: true, concept: "", unlocks: [], phases }], future: [] }).groups[0].phases
}

describe("text guard", () => {
  it("catches every rule on a broken sample", () => {
    const [repair, tutorial] = sample([
      {
        id: "x1",
        type: "repair",
        goal: "x",
        lesson: {
          concept: "",
          discovery: "Primeira. Segunda.",
          observations: [
            { if: {}, say: "Troca o L1, ele tá com defeito 😅", witness: { from: "initial" } },
            { if: {}, say: "A lâmpada apagou e a outra seguiu acesa.", witness: { from: "initial" } },
          ],
        },
        order: { client: "C", object: "o".repeat(81), thanks: "Valeu — demais" },
      },
      { id: "x2", type: "tutorial", goal: "y", order: { client: "Alguém", object: "o", thanks: "t" } },
    ])
    const issues = issuesFor(repair)
    for (const piece of [
      "x1.concept: vazio",
      "x1.discovery: precisa ser uma frase só",
      "x1.observation: cita id de peça",
      "x1.observation: começa mandando fazer",
      "x1.observation: fala em defeito",
      "x1.observation: conta história",
      "x1.observation: proibido",
      "x1.object: passa de 80",
      "x1.thanks: proibido",
    ])
      expect(issues.some((i) => i.startsWith(piece)), piece).toBe(true)
    expect(issuesFor(tutorial)).toEqual(["x2.client: tutorial usa a mentora fixa"])
  })

  it("accepts the style guide examples", () => {
    const [good] = sample([
      {
        id: "y1",
        type: "build",
        goal: "x",
        lesson: {
          concept: "Corrente só anda em caminho fechado. Sai do + da bateria, atravessa as peças e volta pelo −. Se o caminho abre em qualquer ponto, para tudo.",
          discovery: "Numa fila sem desvio, a corrente é a mesma em qualquer ponto do caminho.",
          observations: [{ if: {}, say: "As duas lâmpadas estão apagadas: com um ponto aberto, não tem corrente em nenhum trecho da fila.", witness: { from: "initial" } }],
        },
        order: { client: "Dona Marta, vizinha da oficina", object: "Abajur que não tem como desligar", thanks: "Agora apago da cama mesmo. Deixei um bolo de fubá aí na bancada pra vocês." },
      },
    ])
    expect(issuesFor(good)).toEqual([])
  })

  it("shipped texts follow the guard", () => {
    expect(demo.flatMap(issuesFor)).toEqual([])
  })

  it("every observation can rise", () => {
    for (const p of demo) for (const o of p.lesson?.observations ?? []) expect(observationCanRise(p, o, catalog), `${p.id}: ${o.say}`).toBe(true)
  })

  it("covered groups have lessons and orders everywhere", () => {
    for (const g of data.groups.filter((x) => COVERED_GROUPS.includes(x.id))) {
      for (const p of g.phases) {
        expect(p.lesson, `${p.id}.lesson`).not.toBeNull()
        expect(p.order, `${p.id}.order`).not.toBeNull()
        if (KEY_PHASES.includes(p.id) || p.type === "repair") expect(p.lesson!.observations.length, `${p.id}.observations`).toBeGreaterThan(0)
      }
    }
  })
})
