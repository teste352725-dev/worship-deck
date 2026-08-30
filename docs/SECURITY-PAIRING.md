# Etapa 4 — Pareamento e permissões por dispositivo

A Etapa 4 substitui a ideia de um PIN simples por um modelo de dispositivos confiáveis.

## Objetivos

- celular/tablet encontra e abre o Worship Deck na rede local;
- aparelho novo recebe uma identidade própria;
- sem autorização, o aparelho não pode operar o culto;
- senha administrativa libera acesso temporário;
- o PC do Worship Deck pode aprovar, alterar o papel ou revogar um aparelho;
- aparelhos aprovados entram novamente sem pedir senha;
- pareamentos temporários podem ser gerados no PC e usados por código/URL; o QR gráfico usará o mesmo código e nunca carregará a senha administrativa.

## Papéis

### Guest

Dispositivo detectado, mas ainda não autorizado. Pode consultar apenas o estado básico necessário para apresentar a tela de acesso.

### Operador

Pode operar projeção, favoritos e cenas do OBS.

### Avançado

Inclui Operador e libera Diretor automático e operações técnicas de OBS/Agent.

### Admin

Inclui todos os níveis e libera conexões, configuração, diagnósticos, perfis, backups e administração de dispositivos.

## PC local

Acesso vindo de `127.0.0.1`/`::1` é tratado como Admin local. Isso permite que a igreja sempre consiga recuperar o controle pelo próprio computador, mesmo que um celular seja revogado.

## Senha administrativa

A primeira senha só pode ser criada no próprio PC. O arquivo `security-store.json` guarda `salt` + hash `scrypt`; a senha não é gravada em texto.

Ao digitar a senha em um celular, o servidor entrega uma sessão administrativa temporária de até 8 horas. Essa sessão fica em `sessionStorage` e desaparece ao encerrar a sessão do navegador.

## Dispositivo confiável

Ao aprovar um aparelho, o servidor gera um token aleatório exclusivo. O navegador recebe o token e o guarda em `localStorage`; o servidor guarda apenas o SHA-256 desse token.

Revogar o aparelho apaga o hash aceito pelo servidor, invalidando imediatamente a credencial que ainda estiver salva no celular.

## Descoberta e cadastro

O navegador gera um `deviceId` local e o envia nos headers:

- `X-Worship-Device-Id`
- `X-Worship-Device-Name`
- `X-Worship-Device-Token`
- `X-Worship-Session`

O servidor registra nome, IP, primeiro/último acesso e se o dispositivo está online.

## Pareamento temporário

`POST /api/security/pair/create` cria um código de uso único com validade de 2 minutos e papel escolhido pelo Admin.

`POST /api/security/pair/redeem` troca esse código pela credencial própria do dispositivo.

O código pode ser digitado ou recebido em `/?pair=CODIGO`. O QR gráfico será apenas uma representação dessa URL temporária; ele não conterá senha, token do Holyrics, senha do OBS nem Bridge Secret.

## Arquivos locais

`apps/deck/security-store.json` é criado automaticamente na primeira execução segura e está no `.gitignore`.

Esse arquivo contém identidade da instalação, hashes e lista de dispositivos. Ele não deve ser publicado no GitHub.

## Compatibilidade

A camada é carregada por `secure-entry.js`, que envolve o servidor atual sem duplicar a implementação de Holyrics/OBS. Assim a Etapa 4 pode evoluir sem reescrever o `server.js` grande e já validado.
