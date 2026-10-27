# Bancada de Vibrações

Simulador interativo de sistemas **massa–mola–amortecedor** em 2D, com quantos graus de liberdade você quiser. Monte o sistema com o mouse ou o dedo, puxe e solte as massas, aplique forças e excitações de base, e acompanhe a resposta no tempo, a energia, o espectro, o plano de fase, os modos naturais e a resposta em frequência.

Funciona direto no navegador: HTML, CSS e JavaScript puros, sem build e sem dependências. Basta abrir `index.html` (também funciona via `file://`) ou publicar a pasta no GitHub Pages.

## O que dá para fazer

| Área | Recursos |
|---|---|
| Montagem (modo **Montar**) | bandeja de peças com arrastar e soltar: massa ou apoio solto perto de um nó já entra ligado; mola/amortecedor solto entre dois nós se encaixa entre eles; alça ⊕ em cada nó para puxar uma ligação; duplo clique cria massa; barra de ações junto da peça selecionada (ligar, fixar, travar x/y, trocar tipo, acrescentar em paralelo, excluir); animações de entrada e saída; grade de 5 cm; desfazer/refazer |
| Graus de liberdade | cada massa livre em x, em y ou nos dois (trilhos); sistemas de 1 a centenas de GDL |
| Interação (modo **Ensaiar**) | com a simulação rodando, arrastar uma massa a puxa por uma "mão" elástica; pausado, o arraste define o deslocamento inicial; voltar a Montar reinicia o sistema na condição inicial; zoom por roda/pinça com enquadramento animado |
| Excitações | força harmônica ou varredura de frequência (chirp) em qualquer direção; excitação de base harmônica nos apoios |
| Molas | lineares ou não lineares (termo cúbico de Duffing, `F = k·ΔL + k₃·ΔL³`), geometria exata em 2D (grandes deslocamentos) |
| Análise modal | equilíbrio estático por Newton–Raphson, rigidez tangente com termo geométrico `T/L`, frequências naturais, fatores de amortecimento modais, animação da forma de cada modo e botão "Excitar" para soltar o sistema num modo |
| Gráficos | deslocamento × tempo, energias (cinética, potencial, dissipada, trabalho externo e balanço), FFT com janela de Hann, plano de fase, resposta em frequência com marcação das frequências naturais e comparação previsto × medido |
| Arquivos | exportar/importar o sistema em JSON; salvamento automático no navegador |

Doze sistemas prontos: oscilador livre, comparação de amortecimento (ζ = 0,05; 0,2; 1; 2), massa suspensa com gravidade, ressonância por varredura, excitação de base (suspensão), osciladores acoplados (batimento), absorvedor dinâmico (2 GDL), pêndulo elástico com ressonância interna 2:1, corda discreta (14 GDL), pórtico treliçado sob sismo (12 GDL), malha elástica 2D (48 GDL) e bancada vazia.

## Modelo físico

Para cada massa `i` livre:

```
m_i · a_i = Σ F_molas + Σ F_amortecedores + m_i·g + F_ext,i(t) (+ força da "mão")
```

- **Mola** entre `a` e `b`: `F = k·(L − L₀) + k₃·(L − L₀)³` ao longo do versor `n = (x_b − x_a)/L` (tração positiva).
- **Amortecedor viscoso**: `F = c·(v_b − v_a)·n`.
- **Apoio com excitação de base**: `u(t) = A·sen(2πft + φ)` na direção θ (cinemática imposta).
- Graus de liberdade travados têm velocidade e aceleração nulas (trilho ideal, sem atrito).

Unidades SI em toda a interface: m, kg, s, N, N/m, N·s/m.

### Integração numérica

Runge–Kutta clássico de 4ª ordem com passo `h` limitado por:

- `ω_max·h ≤ 0,15`, com `ω_max²` estimado por um limite de Gershgorin de `M⁻¹K` (inclui rigidez geométrica e termo cúbico);
- (taxa de amortecimento)·`h ≤ 0,5`;
- ≥ 40 passos por período da excitação mais rápida.

O passo nunca depende da taxa de quadros da tela. Se o sistema exige mais passos do que cabem em um quadro, a simulação **desacelera** (o painel avisa) em vez de aumentar o passo.

A energia dissipada e o trabalho das forças externas são integrados junto com o estado. O indicador **balanço** mostra
`|T + V + E_dissipada − W_externo − E₀| / E_vibração`, que deve ficar próximo de zero; é a verificação de confiabilidade em tempo real.

### Análises lineares

- **Equilíbrio**: Newton–Raphson com busca linear sobre `F(u) = 0`; detecta mecanismos e corpos livres.
- **Modos**: `K·φ = ω²·M·φ` resolvido como problema simétrico `M^(−1/2) K M^(−1/2)` (Householder + QL implícito). `ζ_r = φ_rᵀ C φ_r / (2ω_r)` com φ normalizado pela massa, exato para amortecimento proporcional e aproximado nos demais casos.
- **Resposta em frequência**: `(K − ω²M + iωC)·X = F − (K_fb + iωC_fb)·U_b`, por solução complexa direta até 70 GDL e por superposição modal acima disso.

Todas as análises são linearizações em torno do equilíbrio estático; a simulação no tempo é não linear (geometria exata e termo cúbico).

## Validação

`node tests/validate.js` compara o núcleo com soluções analíticas:

| Caso | Referência |
|---|---|
| Oscilador livre | `x(t) = x₀ cos(ωn t)` e conservação de energia |
| Oscilador amortecido | solução subamortecida exata, ζ modal |
| Massa suspensa | deflexão estática `mg/k` |
| Osciladores acoplados | `ω₁ = √(k/m)`, `ω₂ = √((k + 2k_c)/m)` |
| Pêndulo elástico | `√(g/L)` e `√(k/m)` linearizados; energia em grande amplitude |
| Corda discreta | `ω_j = 2√(T/(m a))·sen(jπ/(2(N+1)))` |
| Oscilador forçado | amplitude de regime da FRF e da simulação |
| Excitação de base | transmissibilidade analítica (FRF e simulação) |
| FRF modal × direta | igualdade para `C ∝ K` |
| Pórtico e malha | equilíbrio, modal e balanço de energia com base móvel |

As frequências modais coincidem com as fórmulas até o arredondamento de máquina; as respostas no tempo ficam dentro de 10⁻⁵ (relativo) e o balanço de energia, abaixo de 10⁻⁵.

## Estrutura

```
index.html          interface
css/style.css       estilos (tema claro e escuro)
js/linalg.js        autovalores simétricos, Gauss, FFT
js/model.js         cena: nós, elementos, serialização
js/physics.js       motor RK4, forças, energia
js/analysis.js      equilíbrio, modal, resposta em frequência
js/presets.js       sistemas prontos
js/render.js        desenho da cena
js/charts.js        gráficos
js/inspector.js     painel de propriedades e análise modal
js/dock.js          registro e gráficos da massa observada
js/main.js          interação, laço de animação, arquivos
tests/validate.js   validação contra soluções analíticas
```

## Limitações conhecidas

- Massas pontuais (sem inércia de rotação), sem colisões nem contato.
- Não há barras rígidas; use molas muito rígidas, sabendo que isso reduz o passo de tempo.
- Amortecimento apenas viscoso linear (sem atrito de Coulomb nem histerese).
- A análise modal e a resposta em frequência são lineares; com `k₃ ≠ 0` ou grandes deslocamentos, a simulação no tempo pode diferir delas, como esperado.
- A amostragem dos gráficos é de 200 Hz (Nyquist 100 Hz).

É uma ferramenta didática e de estudo de modelos. Ela não substitui ensaio experimental nem análise por elementos finitos validada no projeto de estruturas ou dispositivos reais.
