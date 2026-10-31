# OpenJarvis: nota ativa do Obsidian

Este plugin envia ao servidor OpenJarvis em `127.0.0.1:8000` **somente o caminho relativo da nota Markdown ou do canvas ativo**. Ele não envia o conteúdo do arquivo. O OpenJarvis só lê ou altera notas e canvases quando você pedir, usando `file_read`, `file_write` e a restrição `security.allowed_dirs` que já existe.

O plugin atualiza o caminho quando você troca de arquivo e envia uma confirmação a cada 15 segundos. O OpenJarvis esquece o caminho depois de 60 segundos sem atualização. Abrir um arquivo que não seja uma nota Markdown ou canvas limpa o arquivo ativo.

## Instalação manual

1. Confirme que o servidor OpenJarvis está rodando em `127.0.0.1:8000`.
2. Copie `manifest.json` e `main.js` para `<cofre>/.obsidian/plugins/openjarvis-active-note/`.
3. No Obsidian, abra **Configurações → Plugins da comunidade**, recarregue os plugins instalados e ative **OpenJarvis Nota Ativa**.
4. Abra uma nota Markdown ou um canvas. A barra inferior deve mostrar **OpenJarvis: arquivo vinculado**.

Se o servidor usar outra porta, ajuste `SERVER_URL` em `main.js` antes de instalar.
