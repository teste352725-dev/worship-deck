# Etapa 3 — Modo de conexão

Objetivo: preparar o mesmo frontend para operar em três modos sem duplicar a interface.

## Modos

- **Automático**: usa o Deck local quando a interface já está sendo servida na rede local; usa o runtime Web quando a interface está no Vercel. No APK, esta política será ampliada para procurar a instalação local antes de cair para o remoto.
- **Local**: força o transporte local. No navegador comum, o modo local funciona de forma segura quando a página já foi aberta pelo endereço local do Worship Deck. Descoberta LAN transparente a partir de uma página HTTPS ficará para o APK, porque navegadores bloqueiam vários cenários de HTTP privado/mixed content.
- **Remoto**: usa a URL Web configurada para o Worship Deck. A camada está pronta para receber o backend V3 do Vercel; enquanto esse backend não expuser todo o contrato `/api/*`, o runtime informa que o remoto ainda não está pronto.

## Persistência

A preferência do aparelho fica em `localStorage` (`worshipDeckConnectionModeV1`). Assim cada celular/tablet pode escolher seu próprio comportamento sem alterar o `config.json` da igreja.

## Segurança

Nenhum token do Holyrics, senha do OBS ou Bridge Secret é gravado pelo seletor de modo. O runtime guarda apenas a preferência (`auto/local/remote`) e endpoints públicos já configurados.

## Regra para o APK

O app Android poderá substituir o resolvedor padrão por um adaptador nativo:

1. procurar Worship Deck pareado na LAN;
2. testar `/api/runtime` e `/api/status` local;
3. se não responder, usar o endpoint Web pareado;
4. exibir OFFLINE somente quando ambos falharem.
