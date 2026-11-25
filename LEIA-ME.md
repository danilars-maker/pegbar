# Pegbar by Coffee Cat — manual em português

Timeline de animação frame a frame e ferramentas de animação para o Photoshop 2025/2026. Gratuito, feito por uma animadora para animadores.

[![Buy Me a Coffee](https://img.shields.io/badge/Me%20pague%20um%20caf%C3%A9-%E2%98%95-FFDD00?style=for-the-badge&logo=buymeacoffee&logoColor=000)](https://buymeacoffee.com/studiocoffeecat)

## Instalar

1. Baixe o arquivo `Pegbar-x.y.z.ccx` na página de [Releases](../../releases).
2. Feche o Photoshop e dê dois cliques no `.ccx`. O app da Creative Cloud instala e avisa que o plugin não vem do Marketplace: confirme.
3. No Photoshop, abra **Plug-ins > Pegbar by Coffee Cat > Pegbar**.

**Se o .ccx não instalar:** instale o *UXP Developer Tools* pela Creative Cloud, marque *Preferências > Plug-ins > Ativar modo de desenvolvedor*, reinicie o Photoshop e, no UXP Developer Tools, clique em **Add Plugin**, escolha `plugin/manifest.json` e clique em **Load**. Nesse modo é preciso carregar de novo a cada vez que o Photoshop abre.

**Se você usava o Fofo Timeline (versão de teste):** desinstale-o pela Creative Cloud (Plug-ins > Gerenciar plug-ins). O Pegbar é instalado como um plugin novo. Seus arquivos continuam funcionando, porque os grupos `[ANIM]` são os mesmos.

## Como funciona

- Uma animação é um **grupo de camadas cujo nome começa com `[ANIM]`**.
- **Cada camada dentro do grupo é um desenho.** A camada de baixo é o frame 1.
- A **exposição** fica no nome da camada: `F003 [x2]` = frame 3 em 2.
- As **etiquetas** são as cores de camada do próprio Photoshop.
- Deixe o papel/fundo **fora** do grupo e desenhe em camadas transparentes.

## Timeline

| Botão | O que faz |
|---|---|
| + Grupo / Usar seleção | Cria um grupo de animação novo, ou transforma as camadas selecionadas em animação |
| Renomear / Cor do grupo | Muda o nome e a etiqueta de cor do grupo (o `[ANIM]` é mantido) |
| \|< < > >\| | Primeiro, anterior, próximo, último frame |
| Play / Stop | Toca no canvas, no fps escolhido, respeitando a exposição |
| FLIPAR | Arraste o controle para folhear os desenhos no canvas |
| Novo / Duplicar / Apagar | Frames novos entram logo depois do atual |
| << Mover / Mover >> | Muda a posição do frame (ou dos selecionados) |
| Recortar / Copiar / Colar | Cola depois do frame atual |
| Exposição - / + | Ajusta o frame atual (ou os selecionados) |
| Padrão x / Aplicar em todos | Exposição dos frames novos (ex.: 2) e botão para colocar em todos |
| Etiqueta | Cor dos frames selecionados |
| Casca de cebola | Frames antes/depois, cor de cada lado, opacidade, colorir e esmaecer |
| Limpar cebola | Tira cor e transparência da cebola (use antes de exportar) |
| Renumerar | Renomeia os frames em ordem: F001, F002… |

Na timeline: clique = ir para o frame; Ctrl+clique = selecionar vários; Shift+clique = selecionar um intervalo; arrastar sobre as miniaturas = flipar.

## Ferramentas (botão "Ferramentas", em abas)

**Pivô (anchor point).** Cada camada pode ter o seu pivô, como no Toon Boom:
- **Da seleção:** faça uma seleção pequena (ou um clique com o Laço) onde quer o pivô e clique em *Da seleção*.
- **9 pontos:** a grade de quadradinhos coloca o pivô nos cantos, nas bordas ou no centro da camada.
- **x / y:** digite a posição em pixels.
- **Centro:** volta para o centro da camada. **mostrar:** marca o pivô com duas guias.

**Girar / Escala.** Gira ou escala as camadas selecionadas **em volta do pivô**, no passo que você escolher (ex.: 15° ou 10%).

**Espelhar objeto.** Espelha a camada selecionada na horizontal ou na vertical, usando o pivô como eixo.

**Ver tela.** *Espelhada* ou *De ponta-cabeça* vira a tela inteira para você conferir o desenho. Aperte o mesmo botão de novo para voltar. (O Photoshop também tem *Visualizar > Inverter horizontalmente*, que só muda a visualização.)

**Desenhar espelhado.** Ativa o pincel. Depois clique na **borboleta** na barra de opções do Photoshop e escolha a simetria (vertical, horizontal, dois eixos, radial…). Tudo que você desenhar de um lado aparece do outro.

**Chaves, Shift & Trace, ciclos**
- **Marcar:** chave (K), extremo (B) ou intervalo (I). A letra aparece na timeline e no nome da camada (`F003 [x2] {K}`).
- **cebola só chaves:** a casca de cebola mostra só chaves e extremos.
- **teste de poses:** o play mostra só chaves e extremos, cada um parado até o próximo.
- **Shift & Trace:** *Anterior* ou *Seguinte* cria uma cópia temporária desse desenho, colorida e fora do grupo. Mova com a ferramenta Mover (V), Ctrl+T, as setas do painel, ou gire/espelhe com as ferramentas de pivô. O desenho original não muda. *Terminar* (ou trocar de frame) apaga a cópia.
- **Ciclo:** repete os frames selecionados (ou todos) N vezes, em *Loop*, *Ping-pong* ou *Aleatório*.

**Grupos e mesa de luz**
- **Sincronizar todos os grupos:** play, flip e navegação mostram todos os grupos `[ANIM]` no mesmo tempo (ex.: rough + clean, personagem + cenário).
- **Mesa de luz:** os outros grupos ficam clarinhos enquanto você desenha no grupo escolhido.

**Guias e timing**
- **Enquadramento:** guias da borda do formato (16:9, 9:16, 1:1, 4:5 ou documento), área de ação (93%) e de título (90%).
- **Gráfico de timing:** desenha numa camada `[GUIA]` a régua de espaçamento entre duas chaves, com o número de intervalos e a suavização (constante, devagar no início, no fim ou nas pontas). Fica no pivô da camada selecionada.

**Exportar**
- **Exportar sequência PNG:** escolha uma pasta; sai um PNG por quadro, com o fundo e sem cebola, respeitando exposição e grupos sincronizados. Importe no editor de vídeo no mesmo fps.

**Modo do play:** ao lado do fps, escolha *Loop*, *Ping-pong* ou *Uma vez*.

## Atalhos

- **Com o painel em foco:** setas ou `,` `.`, espaço (play), `N` (novo), `D` (duplicar), `+` `-` (exposição), `O` (cebola), Delete, Ctrl+X/C/V.
- **Em qualquer lugar:** os comandos ficam em **Plug-ins > Pegbar by Coffee Cat**. Para dar atalhos, vá em *Editar > Atalhos de teclado > Menus do aplicativo* e procure o menu **Plug-ins**.

## Observações

- Em *Preferências > Histórico*, deixe desmarcado "Tornar as alterações de visibilidade de camada desfazíveis", senão o play enche o histórico.
- A cor da cebola usa o efeito "Sobreposição de cores" da camada; estilos de camada próprios em frames podem ser trocados.
- Cada troca de frame vira um passo no histórico (Ctrl+Z volta o frame).

## Apoie ☕

O Pegbar é gratuito. Se ele te ajuda, você pode [me pagar um café](https://buymeacoffee.com/studiocoffeecat).

Feito por **Danila Ribeiro**, na **[Coffee Cat Studio](https://coffeecat.com.br)**. Licença MIT.
