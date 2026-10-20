# Fio Contínuo

Jogo educacional de circuitos elétricos que roda no navegador. Você desenha o circuito num blueprint 2D, com os símbolos da norma, e monta o mesmo circuito numa protoboard 3D. Um simulador de corrente contínua resolve tudo ao vivo: a lâmpada acende, o motor gira, o LED brilha de acordo com a corrente que passa de verdade.

O nome vem da ideia que o jogo quer ensinar: a corrente dá a volta inteira no circuito, ela não se gasta no caminho.

Demo feita para a disciplina **Informática na Educação** (UTFPR). Ela traz 24 fases em 4 grupos: Bancada, Circuitos básicos, Circuitos lógicos e Resistência. Também tem um sandbox livre.

## Requisitos

- [Node.js](https://nodejs.org/) 18 ou mais novo, com npm
- Um navegador atual. O jogo foi testado no Firefox e no Chromium.

## Como rodar

```bash
npm install
npm run dev
```

Abre o endereço que aparecer no terminal (normalmente http://localhost:5173) e clica em **Nova partida**.

### Versão de produção

```bash
npm run build
npm run preview
```

O build fica em `dist/` e é um site estático. Dá pra servir essa pasta com qualquer servidor de arquivos, por exemplo `npx serve dist`.

## Como jogar

- O painel do canto superior direito mostra o objetivo da fase e uma tabela com o que precisa acontecer. Cada linha marca ✓ quando o circuito cumpre aquela condição. Clicar numa linha pré-visualiza aquele cenário sem mexer no circuito.
- A bandeja de baixo traz as peças da fase. O botão **i** de cada peça abre o datasheet dela.
- O botão **Blueprint | Bancada** (ou a tecla `V`) alterna entre o desenho e a montagem. Quando os dois não batem, o jogo mostra onde está a diferença.
- Errar não custa nada: dá pra desfazer, voltar na linha do tempo ou recomeçar a fase. Nada queima nesta demo.

### Atalhos

| Tecla | Ação |
|-------|------|
| `S` | selecionar |
| `W` | desenhar fio |
| `M` | multímetro (a partir do grupo Resistência) |
| `C` | visão de corrente |
| `V` ou `Tab` | trocar entre blueprint e bancada |
| `R` | girar peça / inverter o LED selecionado |
| `F` | enquadrar a câmera |
| `T` | linha do tempo |
| `Delete` | remover a seleção |
| `Esc` | cancelar |
| `Ctrl+Z` / `Ctrl+Y` | desfazer / refazer |

Na bancada, arrastar com o botão esquerdo gira a câmera, a roda dá zoom e o botão direito move a vista.

## Progresso e dados de uso

O progresso fica salvo no `localStorage` do navegador. Se o navegador bloquear o armazenamento, o jogo funciona normalmente e só avisa que não vai salvar.

Em **Configurações → Exportar dados** dá pra baixar um JSON com cada tentativa de fase. O arquivo traz o tempo até vencer, o número de alterações, as dicas oferecidas e abertas, as divergências entre esquema e montagem e o uso do multímetro. Esses dados servem de evidência para a avaliação da disciplina.

## Testes

```bash
npm test           # testes unitários (Vitest): solver, netlist, fases, persistência, textos
npm run typecheck  # checagem de tipos do TypeScript
npm run e2e        # build + smoke test no navegador (Playwright, Firefox e Chromium)
```

Antes de rodar o `npm run e2e` pela primeira vez, instala os navegadores do Playwright:

```bash
npx playwright install firefox chromium
```

## Estrutura

```
src/
  main.ts        inicialização, telas e fluxo da partida
  state.ts       documento do circuito, histórico, salvamento e log de sessão
  netlist.ts     conversão de blueprint e bancada em netlist, comparação entre os dois
  solver.ts      simulador DC por análise nodal modificada (MNA)
  phases.ts      avaliação das fases por cenários, orçamento e dicas
  blueprint.ts   editor 2D em SVG
  bench.ts       bancada 3D com Three.js
  parts3d.ts     texturas, ícones e formatos das peças 3D
  ui.ts          painéis, telas e formatação de valores
  style.css
data/
  phases.json      fases e grupos
  parts.json       catálogo de peças com os valores elétricos
  datasheets.json  textos dos datasheets
tests/             testes unitários
e2e/               smoke test do Playwright
```

Existe uma regra que vale pro projeto inteiro: blueprint e bancada geram a mesma netlist, só o solver calcula grandezas elétricas, e as telas apenas mostram o resultado.

## Créditos e licença

As fontes e demais recursos de terceiros estão listados em [CREDITS.md](CREDITS.md). O código está sob a licença MIT (veja [LICENSE](LICENSE)).
