# Dex V2 transfer

Este diretório contém uma cópia exata de `Dex_v2.zip`, armazenada em partes Base64 porque o conector usado para o upload não envia binários diretamente.

Branch: `dex-v2-transfer`

## Reconstruir o ZIP

No Linux:

```bash
cd docs/dex-v2-transfer
cat chunks/part_*.b64 | tr -d '\n' | base64 -d > Dex_v2.zip
sha256sum Dex_v2.zip
```

O SHA-256 esperado é:

```text
38446cb5738cec000682adaf63db1ca881db1eee0ad47cc755d3d2302579829f  Dex_v2.zip
```

Se o hash conferir:

```bash
unzip Dex_v2.zip
```

O ZIP contém:

```text
Dex/
├── Claude/
│   ├── index.html
│   ├── style.css
│   └── app.js
└── Claude_backup_v1/
    ├── index.html
    ├── style.css
    └── app.js
```

`Dex/Claude/` é a versão V2 refinada que deve ser usada como referência/base para a nova Web Shell.

`Dex/Claude_backup_v1/` é apenas o backup da versão anterior.

## Para o Codex

Você pode clonar diretamente esta branch:

```bash
git clone -b dex-v2-transfer https://github.com/teste352725-dev/worship-deck.git worship-deck-dex-v2
cd worship-deck-dex-v2/docs/dex-v2-transfer
cat chunks/part_*.b64 | tr -d '\n' | base64 -d > Dex_v2.zip
sha256sum Dex_v2.zip
unzip Dex_v2.zip
```

Antes de usar os arquivos, confirme que o SHA-256 é exatamente o valor acima.
